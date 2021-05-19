const SensorConfig = require('./sensor-config.js')
var path = require('path');
var util = require("util");
var MetaWear = require('metawear');
var fs = require('fs');
var ref = require('ref');
var readline = require('readline')
var Session = undefined;

module.exports.prepareMetaCloud = function(device, name) {
  if (Session === undefined) {
    Session = require('metacloud').Session;
  }
  return Session.create(device.firmwareRevision, device.address, device.modelDescription, name, 'MetaBase', '1.0.0');
}

module.exports.createState = async function(capture, sensor, options) {
  let state = {}

  if ('csv' in options) {
    let csv = options['csv'];
    state['path'] = path.join(csv['root'], util.format("%s_%s_%s_%s.csv", csv['name'], csv['now'], csv['address'].toUpperCase().replace(/:/g, ""), sensor))

    var exists = await new Promise((resolve, reject) => {
      var lineReader = readline.createInterface({
        input: fs.createReadStream(state['path']).on('error', (err) => resolve(false))
      });
      var first = true;
      lineReader.on('line', line => {
        if (!first) {
          var parts = line.split(",");
          var buf = ref.alloc('int64');
          ref.writeInt64LE(buf, 0, parts[0]);
  
          if (!('first' in state)) {
            state['first'] = ref.readInt64LE(buf, 0);
          }
          if ('metacloud' in options) {
            var entry = parts.slice(3).map(e => parseFloat(e))
            entry.unshift(ref.readInt64LE(buf, 0));
            options['metacloud'].addData(sensor, entry)
          }
        }
        first = false;
      });
      lineReader.on('close', () => {
        if ('metacloud' in options && state['first'] < options['metacloud'].get('started').getTime()) {
          options['metacloud']['started'] = new Date(state['first'])
        }
        resolve(true);
      });
    })

    let stream = fs.createWriteStream(state['path'], { 'flags': exists ? "a" : "w" })
    if (!exists) {
      SensorConfig[sensor].csvHeader(stream);
    }
    state['csv'] = stream;
  }

  if ('metacloud' in options) {
    state['metacloud'] = options['metacloud'];
  }

  capture(MetaWear.FnVoid_VoidP_DataP.toPointer((ctx, pointer) => SensorConfig[sensor].writeValue(pointer.deref(), state)));

  return state;
}