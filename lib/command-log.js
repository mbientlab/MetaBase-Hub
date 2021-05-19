var MetaWear = require('metawear');
var winston = require('winston');
var util = require("util");
var ref = require("ref")
const SensorConfig = require('./sensor-config.js')
const BleConn = require('./ble-conn.js')

module.exports = async function(config, cache, cacheFile) {
  if (!('devices' in config) || !('sensors' in config)) {
    winston.error("'--device' & '--sensor' options must be used, or 'device' and 'sensor' keys must be set in config file");
    process.exit(1);
    return
  }

  for(let d of config['devices']) {
    winston.info("Connecting to device", { 'mac': d['mac'] });
    try {
      let device = await BleConn.findDevice(d['mac']);
      await BleConn.connect(device, true, cache);
      await BleConn.serializeDeviceState(device, cacheFile, cache)

      await new Promise((resolve, reject) => setTimeout(() => resolve(null), 1000));
      winston.info("Configuring device", { 'mac': d['mac'] });
      let valid = [];
      for(let s of Object.keys(config['sensors'])) {
        if (!(s in SensorConfig)) {
          winston.warn(util.format("'%s' is not a valid sensor name", s));
        } else if (!SensorConfig[s].exists(device.board)) {
          winston.warn(util.format("'%s' does not exist on this board", s), { 'mac': device.address });
        } else {
          valid.push(s);
        }
      };
    
      if (valid.length != 0) {
        if (MetaWear.mbl_mw_metawearboard_lookup_module(device.board, MetaWear.Module.LED) != MetaWear.Const.MODULE_TYPE_NA) {
          let pattern = new MetaWear.LedPattern();
          pattern.repeat_count = 5
          MetaWear.mbl_mw_led_load_preset_pattern(pattern.ref(), MetaWear.LedPreset.BLINK);
          MetaWear.mbl_mw_led_write_pattern(device.board, pattern.ref(), MetaWear.LedColor.GREEN);
          MetaWear.mbl_mw_led_play(device.board);
        }

        const NAME_MAX_CHAR = 26
        let name = 'name' in d ? d['name'] : 'MetaWear'
        if (name.length > NAME_MAX_CHAR) {
          winston.warn(util.format("'%s' is over %d characters, shortening name", name, NAME_MAX_CHAR), {'mac': device.address})
        }

        let buffer = Buffer.from(name.substring(0, 26), 'ascii')
        let length = 5 + buffer.length
        let response = Buffer.alloc(length)
  
        response[0] = length - 1
        response[1] = 0xff
        response[2] = 0x7e
        response[3] = 0x06
        response[4] = 0x02
        buffer.copy(response, 5);
        
        MetaWear.mbl_mw_macro_record(device.board, 1);
        for(let s of valid) {
          await new Promise((resolve, reject) => {
            MetaWear.mbl_mw_datasignal_log(SensorConfig[s].signal(device.board, false), ref.NULL, MetaWear.FnVoid_VoidP_DataLoggerP.toPointer((ctx, logger) => {
              if (logger.address()) resolve(logger)
              else reject('failed to create logger for: ' + s);
            }))
          });
          await SensorConfig[s].configure(device.board, config["sensors"][s]);
        }
        MetaWear.mbl_mw_settings_set_scan_response(device.board, response, response.length);
        await new Promise((resolve, reject) => 
          MetaWear.mbl_mw_macro_end_record(device.board, ref.NULL, MetaWear.FnVoid_VoidP_MetaWearBoardP_Int.toPointer((ctx, pointer, id) =>
            resolve(null)
          ))
        )
  
        MetaWear.mbl_mw_logging_start(device.board, 0);
        for(let s of valid) {
          SensorConfig[s].start(device.board);
        }

        var task = new Promise((resolve, reject) => device.once('disconnect', () => resolve(null)))
        MetaWear.mbl_mw_debug_disconnect(device.board)
        await task;

        winston.info("Begin data recording", { 'mac': d['mac'] });
      } else {
        winston.warn("No sensors were enabled for device", { 'mac': d.address })
      }
    } catch (e) {
      winston.warn(e, {'mac': d['mac']});
    }
  }

  process.exit(0)
}