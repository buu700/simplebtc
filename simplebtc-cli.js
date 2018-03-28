#!/usr/bin/env node


const fs		= require('fs');
const {Wallet}	= require('./simplebtc');

const readLine	= require('readline').createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false
});

const args		= process.argv.slice(2);

const simplebtcrcPath	= require('path').join(
	process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'],
	'.simplebtcrc'
);

const options	= {};


const formatTransaction	= tx => {
	return {
		amount: tx.amount,
		isConfirmed: tx.isConfirmed,
		senders: tx.senders,
		recipients: tx.recipients,
		time: tx.time,
		txid: tx.txid,
		wasSentByMe: tx.wasSentByMe
	};
};

const dothemove	= () => {
	const wallet	= new Wallet(options);

	if (!(options.wif || options.address)) {
		console.log('\nNew wallet created with address ' + wallet.address + '\n');

		if (wallet.key) {
			options.wif	= wallet.key;
		}
		else {
			options.address	= wallet.address;
		}
	}

	fs.writeFileSync(simplebtcrcPath, JSON.stringify(options));
	fs.chmodSync(simplebtcrcPath, 0700);

	switch (args[0]) {
		case 'address':
			console.log(wallet.address);
			process.exit();

			return;

		case 'balance':
			wallet.getBalance(balance => {
				console.log(balance);
				process.exit();
			});

			return;

		case 'history':
			wallet.getTransactionHistory(transactions => {
				console.log(transactions.map(formatTransaction));
				process.exit();
			});

			return;

		case 'stream':
			wallet.onReceive(transaction => {
				console.log(formatTransaction(transaction));
			});

			return;

		case 'send':
			const recipient	= args[1];
			const amount	= args[2];

			if (recipient && amount) {
				wallet.send(recipient, amount, (wasSuccessful, responseMessage) => {
					console.log({
						wasSuccessful: wasSuccessful,
						responseMessage: responseMessage
					});

					process.exit();
				});

				return;
			}
			else {
				break;
			}
	}

	console.log(
		'Available commands:' +
			'\n\t* simplebtc address' +
			'\n\t* simplebtc balance' +
			'\n\t* simplebtc history' +
			'\n\t* simplebtc stream\t# continual stream of new transactions' +
			'\n\t* simplebtc send [recipient address] [amount in local currency]'
	);

	process.exit();
}


try {
	options	= JSON.parse(fs.readFileSync(simplebtcrcPath).toString().trim());
}
catch (_) {}

if (options.wif || options.address) {
	dothemove();
}
else {
	readLine.question('Local currency code (e.g. USD): ', localCurrency => {
		options.localCurrency	= localCurrency.trim();

		readLine.question('Bitcoin wallet WIF (optional): ', wif => {
			options.wif	= wif.trim();

			if (options.wif) {
				dothemove();
			}
			else {
				delete options.wif;

				readLine.question('Bitcoin wallet address (optional, read-only): ', address => {
					options.address	= address.trim();
					dothemove();
				});
			}
		});
	});
}
