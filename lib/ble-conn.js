var MetaWear = require('metawear');
var winston = require('winston');
var ref = require('ref');
var fs = require('fs');

// Async Connect function
async function connect(device, deserialize, cache) {
  await new Promise((resolve, reject) => {
    var timeout = setTimeout(() => reject("Failed to initialize SDK"), 10000);
    var initBuf = undefined;
    
    winston.info("Attempting to connect", { 'mac': device.address});
    if (deserialize && cache.hasOwnProperty(device.address)) {
      var initStr = cache[device.address];
      initBuf = new Buffer(initStr, 'hex');                  
    }
    
    device.connectAndSetUp(error => {
      winston.info("Connected to and setup", { 'mac': device.address});
      clearTimeout(timeout);
      if (error == null) resolve(null)
      else reject(error)
    }, initBuf);
  });
  MetaWear.mbl_mw_settings_set_connection_parameters(device.board, 7.5, 7.5, 0, 6000);
}

// Reconnect function
async function reconnect(device, retries) {
  var timeout = 5;
  while(retries === undefined || retries > 0) {
    try {
      winston.info("Attempting to reconnect", { 'mac': device.address});
      
      device._peripheral.removeAllListeners();
      await connect(device, false);
      
      winston.info("Reconnected to device", { 'mac': device.address});
      retries = -1;
    } catch (e) {
      winston.info("Failed to reconnect (" + e + "), trying again in " + timeout + "s", { 'mac': device.address });
      await new Promise((resolve, reject) => setTimeout(() => resolve(null), timeout * 1000))
      timeout = Math.min(timeout + 10, 60.0);

      if (retries != null) {
        retries--;
      }
    }
  }

  if (retries == 0) {
    winston.info("Failed to reconnect to device", { 'mac': device.address});
  }
}

// Module exports - connect module
module.exports.connect = connect

// Module exports - reconnect module
module.exports.reconnect = reconnect

// Module exports - disconnect module
module.exports.onUnexpectedDisconnect = async function () {
  winston.warn("Connection lost", { 'mac': this.address});
  await reconnect(this);
}

// Module exports - find module
module.exports.findDevice = function (mac) {
  return new Promise((resolve, reject) => {
    var timeout = setTimeout(() => {
      MetaWear.stopDiscoverAll(onDiscover);
      reject("Could not find device");
    }, 10000);
    
    function onDiscover(device) {
      if (device.address.toUpperCase() == mac.toUpperCase()) {
        MetaWear.stopDiscoverAll(onDiscover);
        clearTimeout(timeout);
        resolve(device);
      }
    }

    MetaWear.discoverAll(onDiscover);
  });
}

// Module exports - serial module
module.exports.serializeDeviceState = function(device, dest, cache) {
  var intBuf = ref.alloc(ref.types.uint32);
  var raw = MetaWear.mbl_mw_metawearboard_serialize(device.board, intBuf);
  var sizeRead = intBuf.readUInt32LE();
  var data = ref.reinterpret(raw, sizeRead, 0);
  var initStr = data.toString('hex');
  cache[device.address] = initStr;
  
  return new Promise((resolve, reject) => {
      fs.writeFile(dest, JSON.stringify(cache), err => {
          if (err) reject(err)
          else resolve(null)
      });
  })
}
