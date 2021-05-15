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
		resolve: {
			fallback: {
				assert: require.resolve('assert-browserify'),
				crypto: require.resolve('crypto-browserify'),
				stream: require.resolve('stream-browserify')
			}
		}
	}
];
