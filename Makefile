all:
	rm -rf dist node_modules package-lock.json 2> /dev/null
	mkdir dist node_modules

	npm install

	npx babel simplebtc.js -o dist/simplebtc.js --presets=@babel/preset-env

	webpack --mode none --output-library-target var --output-library simplebtc simplebtc.js -o dist/simplebtc.js

	echo " \
		if (typeof module !== 'undefined' && module.exports) { \
			module.exports	= simplebtc; \
		} \
		else { \
			self.simplebtc	= simplebtc; \
		} \
	" >> dist/simplebtc.js
	terser dist/simplebtc.js -cmo dist/simplebtc.js

clean:
	rm -rf dist node_modules package-lock.json
