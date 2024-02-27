var program = require('commander');
var TestRunner = require('./testRunner.js').testRunner;
var colors = require('colors');
var libpath = require('path');
var fs = require('fs');

require('pretty-error').start();

function clean_dir(val, dir) {
    v = val.split(',')
    .forEach(function(d){
        dir.push(d);
    });
    return dir;
}

program
    .version('0.0.2')
    .option('-x, --xapiVersion [string]', '🌟 New: Version of the xAPI spec to test against')
    .option('-e, --endpoint [url]', 'xAPI Endpoint')
    .option('-u, --authUser [string]', 'Basic Auth Username')
    .option('-p, --authPassword [string]', 'Basic Auth Password')
    .option('-a, --basicAuth', 'Enable Basic Auth')
    .option('-o, --oAuth1', 'Enable oAuth 1')
    .option('-c, --consumer_key [string]', 'oAuth 1 Consumer Key')
    .option('-s, --consumer_secret [string]', 'oAuth 1 Consumer Secret')
    .option('-r, --request_token_path [string]', 'Path to OAuth request token endpoint (relative to endpoint).')
    .option('-t, --auth_token_path [string]', 'Path to OAuth authorization token endpoint (relative to endpoint).')
    .option('-l, --authorization_path [string]', 'Path to OAuth user authorization endpoint (relative to endpoint).')
    .option('-g, --grep [string]', 'Only run tests that match the given pattern.')
    .option('-b, --bail', 'Abort the battery if one test fails.')
    .option('-d, --directory [value]', 'Specific directories of tests (as a comma-separated list with no spaces).', clean_dir, [...[]])
    .option('-z, --errors', 'Results log of failing tests only.')
    .option('-n, --nice', 'Print the error log in a more human-readable format.')
    .parse(process.argv);

var options = {
    xapiVersion: program.xapiVersion,
    endpoint: program.endpoint,
    authUser: program.authUser,
    authPass: program.authPassword,
    basicAuth: program.basicAuth,
    oAuth1: program.oAuth1,
    consumer_key: program.consumer_key,
    consumer_secret: program.consumer_secret,
    request_token_path: program.request_token_path,
    auth_token_path: program.auth_token_path,
    authorization_path: program.authorization_path,
    grep: program.grep,
    bail: program.bail,
    directory: program.directory,
    errors: program.errors,
}

var testRunner = null;

// Catches Ctrl+C event.
process.on('SIGINT', function() {
    console.log(colors.white('Aborting tests.'));
	testRunner.cancel();
});


process.on('exit', function() {
    console.log(colors.white('Closed'));
});

function printHumanReadableLog(test, level) {
  if (!test) return;
  var hasChildren = test.tests && test.tests.length > 0;
  var indent = Array(level).join(" ");
  console.log();
  console.log(indent + (hasChildren ? '🤜' : '❗️') +' ' + (test.name || "Test"));
  if (hasChildren) {
    test.tests.forEach(function(test) {
      printHumanReadableLog(test, level + 2);
    });
  } else {
    console.log(indent + "   " + test.status + ": " + test.error.replace(/\n/g, "\n" + indent + "           "));
  }
}

function start(options)
{
    //These are already used to fetch the access token, and are not needed by the runer
    delete options.request_token_path;
    delete options.auth_token_path;
    delete options.authorization_path;

	testRunner = new TestRunner('console', null, options);
    testRunner.start();

	var interval = setInterval(function(){
		console.log(JSON.stringify(testRunner.summary));
	}.bind(this), 2000);

	testRunner.on('message', function(msg)
	{

		if(msg.action === 'log'){
			console.log(msg.payload);
		}
		else if(msg.action === 'end')
		{
			clearInterval(interval);
			console.log(JSON.stringify(testRunner.summary));
			console.log(`Tests completed in ${testRunner.duration/1000} seconds`);

			function removeNulls (log)
			{
				var temp;

				if (log && log.status === 'failed')
				{
					temp = {
						title: log.title,
						name: log.name,
						requirement: log.requirement,
						log:log.log,
						status: log.status,
						error: log.error
					};
					var t = log.tests.map(removeNulls);
					if (t) temp.tests = t.filter(function(v){return v != undefined});
				}
				return temp;
			}

			// Write log to file.
			var cleanLog = testRunner.getCleanRecord();
			var output;
			if (options.errors) {
				var errOnly = {
					name: cleanLog.name,
					owner: cleanLog.owner,
					flags: cleanLog.flags,
					options: cleanLog.options,
					rollupRule: cleanLog.rollupRule,
					uuid: cleanLog.uuid,
					startTime: cleanLog.startTime,
					endTime: cleanLog.endTime,
					duration: cleanLog.duration,
					state: cleanLog.state,
					summary: cleanLog.summary,
					log: removeNulls(cleanLog.log)
				};
				output = JSON.stringify(errOnly, null, '    ');
			} else {
				output = JSON.stringify(cleanLog, null, '    ');
			}

			var outDir = libpath.join(__dirname, '../logs');

            // console.log(require("util").inspect(JSON.parse(JSON.stringify(cleanLog,function(k,v){if(k=="log" && v && v.constructor == String) return undefined; return v})),{depth:10}));

			fs.mkdir(outDir, 0o775, function(){
				var outPath = libpath.join(outDir, testRunner.uuid+'.log');
				fs.writeFile(outPath, output, (err, data) => {
					if (err) {
						console.log(err);
						return process.exit(1);
					}
					console.log('Full run log written to', outPath);

          if (program.nice) {
            printHumanReadableLog(removeNulls(cleanLog.log), 0);
          }

					return process.exit(testRunner.summary.failed);
				});
			});
		}
	});
}

if (!program.oAuth1)
	start(options);
else {


    var config = {};
    config.consumer_key = options.consumer_key;
    config.consumer_secret = options.consumer_secret;

    //defaults for the ADL LRS
    config.request_token_path = options.request_token_path || '/OAuth/initiate';
    config.auth_token_path = options.auth_token_path ||'/OAuth/token';
    config.authorization_path = options.authorization_path || "/../accounts/login?next=/XAPI/OAuth/authorize";

    config.endpoint = options.endpoint;
    require("./OAuth.js").auth(config, function(err, oAuth) {

        if (err) {
            console.log(err);
            process.exit();
        }
        options.consumer_key = options.consumer_key;
        options.consumer_secret = options.consumer_secret;
        options.token = oAuth.token;
        options.token_secret = oAuth.token_secret;
        options.verifier = oAuth.verifier;


        var OAUTH = {

            consumer_key: options.consumer_key,
            consumer_secret: options.consumer_secret,
            token: options.token,
            token_secret: options.token_secret,
            verifier: options.verifier
        }

		start(options);
    });
}
