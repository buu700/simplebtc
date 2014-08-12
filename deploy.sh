#!/bin/bash

dir="$(pwd)"
cd $(dirname `readlink -f "${0}" || realpath "${0}"`)

sudo echo -n

git pull

rm -rf build
mkdir build
cd build

sudo npm -g remove bitcoinjs-lib
sudo npm -g update
sudo npm -g install bitcoinjs-lib browserify uglify-js

browserify -r bitcoinjs-lib -s Bitcoin | uglifyjs > bitcoinjs.min.js
curl -s 'http://bitcore.io/js/bitcore.js' | uglifyjs > bitcore.min.js
echo "
	`curl -s 'http://cdnjs.cloudflare.com/ajax/libs/json2/20110223/json2.js'`
	`curl -s 'https://raw.githubusercontent.com/andris9/jStorage/master/jstorage.js'`
" | uglifyjs > jstorage.min.js

cat ../simplebtc.js | sed "/\/\*\*\* BitcoinJS \*\*\*\//{
	s/.*//g
	r bitcoinjs.min.js
}" | sed "/\/\*\*\* Bitcore \*\*\*\//{
	s/.*//g
	r bitcore.min.js
}" | sed "/\/\*\*\* jStorage \*\*\*\//{
	s/.*//g
	r jstorage.min.js
}" > ../simplebtc-complete.js

uglifyjs ../simplebtc-complete.js > ../simplebtc-complete.min.js

cd ..
rm -rf build

chmod 777 -R .
git add .
git commit -a -m "${*}"
git push

npm publish ./

sudo npm -g update

cd "${dir}"
