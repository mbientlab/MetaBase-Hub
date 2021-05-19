var ArgumentParser = require('argparse').ArgumentParser;

module.exports.setup = () => {
  var parser = new ArgumentParser({
    version: '1.1.1',
    addHelp:true,
    description: 'NodeJS app to stream sensor data to MetaHub'
  });

  parser.addArgument([ '--device' ], {
    help: 'MAC address of the device to use',
    action: 'append',
    metavar: 'mac',
    type: "string"
  });
  parser.addArgument([ '--list-sensors' ], {
    help: 'Show available sensors and frequencies',
    nargs: 0
  });
  parser.addArgument([ '--sensor' ], {
    help: 'Key-value pair that sets a sensors sampling frequency',
    action: 'append',
    metavar: 'sensor=freq'
  });
  parser.addArgument(['--config'], {
    help: 'Path to the config file to load',
    metavar: 'path'
  });
  parser.addArgument(['--cloud-user'], {
    help: 'MetaCloud user name',
    metavar: 'name'
  });
  parser.addArgument(['--cloud-passwd'], {
    help: 'MetaCloud password',
    metavar: 'pw'
  });
  parser.addArgument(['-o'], {
    help: 'Path to store the CSV files',
    metavar: 'path'
  });
  parser.addArgument(['--width'], {
    help: 'Window width',
    metavar: 'res',
    type: 'int'
  });
  parser.addArgument(['--height'], {
    help: 'Window height',
    metavar: 'res',
    type: 'int'
  });
  parser.addArgument(['--no-graph'], {
    help: 'Disables the real time graph',
    nargs: 0
  });
  parser.addArgument(['--fps'], {
    help: 'Target frames per second for the real time graph, defaults to 10fps',
    type: 'int'
  });
  parser.addArgument(['--command'], {
    help: 'Whether to stream, log, or download data.  Defaults to \'stream\' if not set',
    choices: ['stream', 'log', 'download']
  });

  return parser;
}