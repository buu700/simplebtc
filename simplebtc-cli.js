#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const {Wallet} = require('./simplebtc');

const readLine = require('readline').createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false
});

const args = process.argv.slice(2);

const simplebtcrcPath = require('path').join(os.homedir(), '.simplebtcrc');

let options = {};

const formatTransaction = tx => {
	const o = {...tx};
	delete o.baseTransaction;
	return o;
};

const dothemove = async () => {
	const wallet = new Wallet(options);

	if (
		!(
			(typeof options.address === 'string' &&
				options.address.length > 0) ||
			(typeof options.key === 'string' && options.key.length > 0)
		)
	) {
		console.log(
			'\nNew wallet created with address ' + wallet.address + '\n'
		);

		if (wallet.key) {
			options.key = wallet.key.toWIF();
		}
		else {
			options.address = wallet.address;
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
			console.log(await wallet.getBalance());
			process.exit();

			return;

		case 'history':
			console.log(
				(await wallet.getTransactionHistory()).map(formatTransaction)
			);
			process.exit();

			return;

		case 'stream':
			wallet.watchNewTransactions().subscribe(transaction => {
				console.log(formatTransaction(transaction));
			});

			return;

		case 'send':
			const recipient = args[1];
			const amount = args[2];

			if (recipient && amount) {
				console.log(
					await wallet.send(recipient, amount).catch(err => ({err}))
				);
				process.exit();

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
};

try {
	options = JSON.parse(
		fs
			.readFileSync(simplebtcrcPath)
			.toString()
			.trim()
	);
}
catch (_) {}

if (
	(typeof options.address === 'string' && options.address.length > 0) ||
	(typeof options.key === 'string' && options.key.length > 0)
) {
	dothemove();
}
else {
	readLine.question('Local currency code (e.g. USD): ', localCurrency => {
		options.localCurrency = localCurrency.trim();

		readLine.question('Bitcoin wallet WIF (optional): ', key => {
			options.key = key.trim();

			if (options.key.length > 0) {
				dothemove();
			}
			else {
				delete options.key;

				readLine.question(
					'Bitcoin wallet address (optional, read-only): ',
					address => {
						options.address = address.trim();
						dothemove();
					}
				);
			}
		});
	});
}
