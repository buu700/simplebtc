all:
	rm -rf dist node_modules package-lock.json 2> /dev/null
	mkdir dist node_modules

	npm install

	webpack --output-library-target var --output-library simplebtc simplebtc.js dist/simplebtc.js
	echo " \
		if (typeof module !== 'undefined' && module.exports) { \
			module.exports		= simplebtc; \
		} \
		else { \
			self.simplebtc	= simplebtc; \
		} \
	" >> dist/simplebtc.js
	uglifyjs dist/simplebtc.js -cmo dist/simplebtc.js

	rm -rf node_modules package-lock.json

clean:
	rm -rf dist node_modules package-lock.json
