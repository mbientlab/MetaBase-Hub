var MetaWear = require('metawear');
var winston = require('winston');
var moment = require("moment");
var fs = require('fs');
var util = require('util');
var ref = require('ref');
const BleConn = require('./ble-conn.js')
const DataCapture = require('./data-capture.js');

var identifierToName = {
  'acceleration': 'Accelerometer',
  'illuminance': 'Ambient Light',
  'pressure': 'Pressure',
  'relative-humidity': 'Humidity',
  'angular-velocity': 'Gyroscope',
  'magnetic-field': 'Magnetometer',
  'quaternion': 'Quaternion',
  'euler-angles': 'Euler Angles',
  'gravity': 'Gravity',
  'linear-acceleration': 'Linear Acceleration',
  'temperature' : 'Temperature',
  'humidity' : 'Humidity',
}

// adopted from https://stackoverflow.com/a/34325723
function printProgress(iteration, total, prefix, suffix, decimals, bar_length) {
  let percents = (100 * (iteration / parseFloat(total))).toFixed(decimals)
  let filled_length = parseInt(Math.round(bar_length * iteration / parseFloat(total)))

  let bar = '';
  for(let i = 0; i < filled_length; i++) {
    bar+= '█';
  }
  for(let i = 0; i < (bar_length - filled_length); i++) {
    bar+= '-';
  }

  process.stdout.write(util.format('\r%s |%s| %s%s %s', prefix, bar, percents, '%', suffix))

  if(iteration == total) {
      process.stdout.write('\n')
  }
}

module.exports = async function(config, cache, cacheFile) {
  if (!('devices' in config)) {
    winston.error("'--device' options must be used, or 'device' key must be set in config file");
    process.exit(1);
    return
  }

  var devices = [];
  for(let d of config['devices']) {
    winston.info("Connecting to device", { 'mac': d['mac'] });
    try {
      let device = await BleConn.findDevice(d['mac']);
      await BleConn.connect(device, true, cache);
      await BleConn.serializeDeviceState(device, cacheFile, cache)
      
      let name
      let valid = true;
      if (device._peripheral['advertisement']['manufacturerData'] === undefined ) {
        name = ('name' in d ? d['name'] : 'MetaWear')
        winston.warn(util.format("no manufacturing data in ad packet, defaulting name to '%s'", name), {'mac': d['mac']})
      } else {
        let mftData = device._peripheral['advertisement']['manufacturerData'];
        if (mftData[0] == 0x7e && mftData[1] == 0x06) {
          if (mftData[2] == 0x2) {
            name = mftData.toString('ascii', 3)
          } else {
            winston.warn("Device is not compatible with MetaBase, skipping", {'mac': d['mac']})
            valid = false
          }
        } else if (mftData[0] == 0x6d && mftData[1] == 0x62) {
          name = mftData.toString('ascii', 2)
        } else {
          winston.warn("Invalid manufacturer id detected, skipping device", {'mac': d['mac']})
          valid = false
        }
      }
      if (valid) {
        devices.push([device, name]);
      }
    } catch (e) {
      winston.warn(e, {'mac': d['mac']});
    }
  }

  await new Promise((resolve, reject) => setTimeout(() => resolve(null)), 1000);

  let tasks = [];
  let valid = [];
  for(let it of devices) {
    let d = it[0]
    try {
      winston.info("Syncing log information", { 'mac': d.address });
      it.push(await new Promise((resolve, reject) => MetaWear.mbl_mw_metawearboard_create_anonymous_datasignals(d.board, ref.NULL, 
        MetaWear.FnVoid_VoidP_MetaWearBoardP_AnonymousDataSignalP_UInt.toPointer((ctx, board, anonymousSignals, size) => {
          if (anonymousSignals) {
            if (size == 0) {
              reject("device is not logging any sensor data")
            } else {
              anonymousSignals.length = size;
              resolve(anonymousSignals);
            }
          } else {
            reject("failed to create anonymous data signals (status = " + size + ")");
          }
        }
      ))));
      valid.push(it)
      tasks.push(new Promise((resolve, reject) => d.once('disconnect', () => resolve(null))))
      MetaWear.mbl_mw_debug_reset(d.board)
      winston.info("Resetting device", { 'mac': d.address });
    } catch (e) {
      winston.warn(e, {'mac': d.address})
      MetaWear.mbl_mw_debug_disconnect(d.board)
    }
  }

  await Promise.all(tasks);

  for(let it of valid) {
    let states = []
    let d = it[0]
    await BleConn.reconnect(d, 3);
    await new Promise((resolve, reject) => setTimeout(() => resolve(null)), 1000);

    var session = undefined;
    if ('cloudLogin' in config) {
      session = DataCapture.prepareMetaCloud(d, it[1]);
    }

    for (let i = 0; i < it[2].length; i++) {
      let options = {
        csv: {
          name: it[1],
          root: config['csv'],
          now: '@',
          address: d.address,
        }
      }
      if (session !== undefined) {
        options['metacloud'] = session;
      }

      let valid = true;
      var identifier = MetaWear.mbl_mw_anonymous_datasignal_get_identifier(it[2][i]);
      if (!(identifier in identifierToName)) {
        if (!identifier.startsWith('temperature')) {
          winston.warn("Unrecognized log identifier: " + identifier)
          valid = false;
        } else {
          identifier = 'temperature';
        }
      }
      if (valid) {
        states.push(await DataCapture.createState((handler) => MetaWear.mbl_mw_anonymous_datasignal_subscribe(it[2][i], ref.NULL, handler), 
            identifierToName[identifier], options));
      }
    }

    try {
      await new Promise((resolve, reject) => {
        if (states.length == 0) {
          reject("No supported sensors available for download")
        } else {
          if (MetaWear.mbl_mw_metawearboard_lookup_module(d.board, MetaWear.Module.LED) != MetaWear.Const.MODULE_TYPE_NA) {
            let pattern = new MetaWear.LedPattern();
            pattern.repeat_count = 5
            MetaWear.mbl_mw_led_load_preset_pattern(pattern.ref(), MetaWear.LedPreset.BLINK);
            MetaWear.mbl_mw_led_write_pattern(d.board, pattern.ref(), MetaWear.LedColor.BLUE);
            MetaWear.mbl_mw_led_play(d.board);
          }

          d.once('disconnect', () => reject("Connection lost during download"));

          var downloadHandler = new MetaWear.LogDownloadHandler();
          downloadHandler.context = ref.NULL
          downloadHandler.received_progress_update = MetaWear.FnVoid_VoidP_UInt_UInt.toPointer((ctx, entriesLeft, totalEntries) => {
            printProgress(totalEntries - entriesLeft, totalEntries, "Progress", "Complete", 2, 50);
            if (entriesLeft === 0) {
              resolve(null);
            }
          });
          downloadHandler.received_unknown_entry = MetaWear.FnVoid_VoidP_UByte_Long_UByteP_UByte.toPointer((ctx, id, epoch, data, length) => {
            winston.warn('received_unknown_entry', { 'mac': d.address });
          });
          downloadHandler.received_unhandled_entry = MetaWear.FnVoid_VoidP_DataP.toPointer((ctx, dataPtr) => {
            var data = dataPtr.deref();
            var dataPoint = data.parseValue();
            winston.warn('received_unhandled_entry: ' + dataPoint, { 'mac': d.address });
          });

          winston.info("Downloading log", { 'mac': d.address });
          // Actually start the log download, this will cause all the handlers we setup to be invoked
          MetaWear.mbl_mw_logging_download(d.board, 100, downloadHandler.ref());
        }
      });

      winston.info("Download completed", { 'mac': d.address });
      MetaWear.mbl_mw_macro_erase_all(d.board)
      MetaWear.mbl_mw_debug_reset_after_gc(d.board)
  
      var task = new Promise((resolve, reject) => d.once('disconnect', () => resolve(null)));
      MetaWear.mbl_mw_debug_disconnect(d.board);
      await task;
  
      if ('cloudLogin' in config) {
        winston.info("Syncing data to MetaCloud", {'mac': d.address});
        try {
          await new Promise((resolve, reject) => {
            session.sync(config['cloudLogin']['username'], config['cloudLogin']['password'], (error, result) => {
              if (error == null) resolve(result)
              else reject(error);
            });
          });
          winston.info("Syncing completed", {'mac': d.address});
        } catch (e) {
          winston.warn("Could not sync data to metacloud", { 'error': e });
        }
      }

      await Promise.all(states.map(s => {
        s['csv'].end();
        return new Promise((resolve, reject) => fs.rename(s['path'], s['path'].replace(/@/g, moment(s['first']).format("YYYY-MM-DDTHH-mm-ss.SSS")), err => {
          if (err) reject(err)
          else resolve(null)
        }))
      }))
    } catch (e) {
      winston.warn(e, {'mac': d.address})
      states.forEach(s => s['csv'].end())
    }
  }

  process.exit(0)
}