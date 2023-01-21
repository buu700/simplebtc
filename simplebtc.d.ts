import {PrivateKey} from 'bitcore-lib';
import {Observable} from 'rxjs';

declare module 'simplebtc' {
	/** A Bitcoin transaction record. */
	interface Transaction {
		/** Transaction amount (in local currency). */
		amount: number;

		/** Transaction ID. */
		id: string;

		/** Indicates whether transaction is confirmed. */
		isConfirmed: boolean;

		/** Recipient addresses. */
		recipients: string[];

		/** Sender addresses. */
		senders: string[];

		/** Timestamp. */
		timestamp: number;

		/** Indicates whether the current wallet was the sender. */
		wasSentByMe: boolean;
	}

	/** A Bitcoin wallet. */
	class Wallet {
		/** Wallet address. */
		readonly address: string;

		/**
		 * Indicates whether this is a Bitcoin Cash wallet.
		 * For compatibility, the API will still use the string
		 * and property name "BTC" in either case.
		 */
		readonly bitcoinCash: boolean;

		/** Indicates whether wallet is read-only (i.e. private key is unknown). */
		readonly isReadOnly: boolean;

		/** Wallet private key. */
		readonly key: PrivateKey & {
			toBuffer: () => Uint8Array;
			toWIF: () => string;
		};

		/** Local currency code (BTC by default). */
		readonly localCurrency: string;

		/** Static fee for all transactions (in BTC/BCH). */
		readonly transactionFee: number;

		/** Static fee for all transactions (in satoshis). */
		readonly transactionFeeSatoshi: number;

		/** Gets balance in BTC (or BCH, if applicable) and local currency. */
		getBalance () : Promise<{btc: number; local: number}>;

		/** Gets transaction history, sorted by timestamp in descending order. */
		getTransactionHistory () : Promise<Transaction[]>;

		/**
		 * Sends money.
		 * @param amount Amount in local currency.
		 * @returns Server broadcast method response message.
		 */
		send (
			recipientAddress:
				| string
				| Wallet
				| {getAddress: () => {toString: () => string}},
			amount: number
		) : Promise<string>;

		/**
		 * Watches for new transactions as they occur.
		 * NOTE: Currently unsupported with Bitcoin Cash (never emits).
		 */
		watchNewTransactions (
			shouldIncludeUnconfirmed?: boolean
		) : Observable<Transaction>;

		/**
		 * Watches transaction history.
		 * NOTE: Currently unsupported with Bitcoin Cash (only emits once).
		 */
		watchTransactionHistory (
			shouldIncludeUnconfirmed?: boolean
		) : Observable<Transaction[]>;

		constructor (
			options?:
				| Wallet
				| {
						address?: string;
						bitcoinCash?: boolean;
						key?: Uint8Array | string;
						localCurrency?: string;
						uncompressedPublicKey?: boolean;
				  }
		) ;
	}

	/** Minimum ("dust") transaction amount. */
	const minimumTransactionAmount: number;

	/** Static fees for all transactions (in BTC/BCH). */
	const transactionFees: {bitcoin: number; bitcoinCash: number};

	/** Static fees for all transactions (in satoshis). */
	const transactionFeesSatoshi: {bitcoin: number; bitcoinCash: number};

	/** Returns exchange rates between various currencies and Bitcoin or Bitcoin Cash. */
	const getExchangeRates: (
		bitcoinCash?: boolean
	) => Promise<{[currencyCode: string]: number}>;

	/** Sets Blockchain.com API key. */
	const setBlockchainAPIKey: (apiKey: string) => void;

	/** Sets FullStack.Cash API token. */
	const setFullStackCashAPIToken: (
		apiToken: string,
		tier: 0 | 1 | 2 = 1
	) => void;
}
