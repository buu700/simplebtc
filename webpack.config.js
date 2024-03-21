const {ProvidePlugin} = require('webpack');

module.exports = [
	{
		entry: './dist/simplebtc.js',
		mode: 'none',
		output: {
			filename: './simplebtc.global.js',
			globalObject: 'self',
			library: 'simplebtc',
			libraryTarget: 'umd'
		},
		plugins: [
			new ProvidePlugin({
				Buffer: ['buffer', 'Buffer'],
				process: 'process/browser'
			})
		],
		resolve: {
			alias: {
				assert: 'assert-browserify',
				crypto: 'crypto-browserify',
				stream: 'stream-browserify',
				vm: 'vm-browserify'
			}
		}
	}
];
