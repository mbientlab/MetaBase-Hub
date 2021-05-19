var MetaWear = require('metawear');
var winston = require('winston');
var moment = require("moment");
var ref = require("ref");
var util = require("util");
var path = require('path');
const DataCapture = require('./data-capture.js');
const BleConn = require('./ble-conn.js')
const SensorConfig = require('./sensor-config.js')

var createWindow = undefined;
async function start(options, config, cache, cacheFile) {
  var sessions = [];
  var states = [];
  var devices = [];

  for(let d of config['devices']) {
    winston.info("Connecting to device", { 'mac': d['mac'] });
    try {
        let device = await BleConn.findDevice(d['mac']);
        await BleConn.connect(device, true, cache);
        await BleConn.serializeDeviceState(device, cacheFile, cache)
        
        device.once('disconnect', BleConn.onUnexpectedDisconnect)
        devices.push([device, 'name' in d ? d['name'] : 'MetaWear']);
    } catch (e) {
        winston.warn(e, {'mac': d['mac']});
    }
  }

  if (!devices.length) {
    winston.error("Failed to connect to any devices, terminating app");
    process.exit(0);
    return;
  }

  await new Promise((resolve, reject) => setTimeout(() => resolve(null)), 1000);

  winston.info("Configuring devices")
  var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
  var x = -1, y = 0;
  for(let it of devices) {
    let d = it[0]

    var session = undefined;
    if ('cloudLogin' in config) {
        session = DataCapture.prepareMetaCloud(d, it[1]);
        sessions.push(session);
    }

    let current_states = []
    let sensors = [];
    for(let s of Object.keys(config['sensors'])) {
      if (!(s in SensorConfig)) {
        winston.warn(util.format("'%s' is not a valid sensor name", s));
      } else if (!SensorConfig[s].exists(d.board)) {
        winston.warn(util.format("'%s' does not exist on this board", s), { 'mac': d.address });
      } else {
        let options = {
          csv: {
            name: it[1],
            root: config['csv'],
            now: now,
            address: d.address,
          }
        }
        if (session !== undefined) {
          options['metacloud'] = session;
        }
        let state = await DataCapture.createState((handler) => MetaWear.mbl_mw_datasignal_subscribe(SensorConfig[s].signal(d.board, true), ref.NULL, handler), s, options);
        
        state['update-graph'] = createWindow !== undefined ? 
            (data) => windows[d.address].webContents.send(`update-${s}-${d.address}` , data) :
            (data) => {}
        
        current_states.push(state)
        states.push(state);
        sensors.push(s);
      }
    };

    if (sensors.length != 0) {
      if (createWindow !== undefined) {
        let sizes = {
          'width': options['electron'].screen.getPrimaryDisplay().size.width,
          'height': options['electron'].screen.getPrimaryDisplay().size.height
        };
        if (!('resolution' in config)) {
          config["resolution"] = { }
        }
        if (!('width' in config['resolution']) || config['resolution']['width'] == null) {
          config['resolution']['width'] = sizes['width'] / 2
        }
        if (!('height' in config['resolution']) || config['resolution']['height'] == null) {
          config['resolution']['height'] = sizes['height'] / 2
        }

        if (x < 0) {
          x = sizes['width'] - config['resolution']['width'];
        }
        createWindow(current_states, config['fps'], d.address, it[1], sensors.map(s => `${s}=${SensorConfig[s].odrToMs(config["sensors"][s])}`), config['resolution'], x, y)

        x -= config['resolution']['width'];
        if (x < 0) {
          y += config['resolution']['height'];
          if (y >= sizes['height']) {
              y = 0;
          }
        }
      }
      for(let s of sensors) {
          await SensorConfig[s].configure(d.board, config["sensors"][s]);
          SensorConfig[s].start(d.board);
      }
    } else {
        winston.warn("No sensors were enabled for device", { 'mac': d.address })
    }
  }
  
  if (states.length == 0) {
      winston.error("No active sensors to receive data from, terminating app")
      return;
  }
  process.openStdin().addListener("data", async data => {
    winston.info("Resetting devices");
    Promise.all(devices.map(d => {
      if (d[0]._peripheral.state !== 'connected') {
        return Promise.resolve(null);
      }
      d[0].removeListener('disconnect', BleConn.onUnexpectedDisconnect);
      var task = new Promise((resolve, reject) => d[0].once('disconnect', () => resolve(null)))
      MetaWear.mbl_mw_debug_reset(d[0].board)
      return task
    })).then(async results => {
      states.forEach(s => s['csv'].end());

      if ('cloudLogin' in config) {
        winston.info("Syncing data to MetaCloud");
        for(let s of sessions) {
          try {
            await new Promise((resolve, reject) => {
              s.sync(config['cloudLogin']['username'], config['cloudLogin']['password'], (error, result) => {
                if (error == null) resolve(result)
                else reject(error);
              });
            });
          } catch (e) {
            winston.warn("Could not sync data to metacloud", { 'error': e });
          }
        }
        winston.info("Syncing completed");
      }
      process.exit(0)
    })
  });
  winston.info("Streaming data to host device");
  winston.info("Press [Enter] to terminate...");
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var windows = {};

module.exports = (config, noGraph, cache, cacheFile) => {
  if (!('devices' in config) || !('sensors' in config)) {
    winston.error("'--device' & '--sensor' options must be used, or 'device' and 'sensor' keys must be set in config file");
    process.exit(1);
    return
  }

  if (!noGraph) {
    const electron = require('electron')
    // Module to control application life.
    const app = electron.app
    // Module to create native browser window.
    const BrowserWindow = electron.BrowserWindow
    const url = require('url')

    let options = {
        'electron': electron
    }
    app.on('window-all-closed', function () {
    });
    app.on('browser-window-created',function(e,window) {
        window.setMenu(null);
    });

    createWindow = (states, fps, mac, title, sensors, resolution, x, y) => {
      let attr = Object.assign({title: `${title} (${mac.toUpperCase()})`, x: x, y: y}, resolution);
      // Create the browser window.
      let newWindow = new BrowserWindow(attr)
      windows[mac] = newWindow;
    
      // and load the index.html of the app.
      newWindow.loadURL(url.format({
        pathname: path.join(__dirname, '..', 'views', 'index.html'),
        protocol: 'file:',
        slashes: true,
        search: `fps=${fps}&mac=${mac}&sensors=${sensors.join(',')}&width=${resolution['width']}&height=${resolution['height']}`
      }))
    
      // Open the DevTools.
      // mainWindow.webContents.openDevTools()
    
      // Emitted when the window is closed.
      newWindow.on('closed', function () {
        winston.info("Window closed, data is still being written to the CSV file", { 'mac': mac })
        states.forEach(s => s['update-graph'] = (data) => {})
        delete windows[mac]
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        newWindow = null
      })
    
      newWindow.on('resize', () => newWindow.webContents.send(`resize-${mac}` , newWindow.getSize()));
    }
    
    app.on('ready', () => start(options, config, cache, cacheFile));
  } else {
    start({}, config, cacheFile, cacheFile);
  }
}