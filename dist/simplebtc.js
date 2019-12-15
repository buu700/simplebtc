"use strict";var _interopRequireDefault=require("@babel/runtime/helpers/interopRequireDefault"),_slicedToArray2=_interopRequireDefault(require("@babel/runtime/helpers/slicedToArray")),_classCallCheck2=_interopRequireDefault(require("@babel/runtime/helpers/classCallCheck")),_createClass2=_interopRequireDefault(require("@babel/runtime/helpers/createClass")),_regenerator=_interopRequireDefault(require("@babel/runtime/regenerator")),_typeof2=_interopRequireDefault(require("@babel/runtime/helpers/typeof")),isNode="object"===("undefined"==typeof process?"undefined":(0,_typeof2.default)(process))&&"function"==typeof require&&"object"!==("undefined"==typeof window?"undefined":(0,_typeof2.default)(window))&&"function"!=typeof importScripts,rootScope=isNode?global:self,_require=require("bitcore-lib/lib/address"),addressIsValid=_require.isValid,BitcorePrivateKey=require("bitcore-lib/lib/privatekey"),BitcoreTransaction=require("bitcore-lib/lib/transaction"),FormData=require("form-data"),_require2=require("rxjs"),ReplaySubject=_require2.ReplaySubject,Subject=_require2.Subject,_require3=require("rxjs/operators"),map=_require3.map,mergeMap=_require3.mergeMap,fetch="function"==typeof rootScope.fetch?rootScope.fetch:isNode?eval("require")("node-fetch"):require("whatwg-fetch"),sleep=function(){var e,t=arguments;return _regenerator.default.async((function(r){for(;;)switch(r.prev=r.next){case 0:return e=t.length>0&&void 0!==t[0]?t[0]:250,r.abrupt("return",new Promise((function(t){setTimeout(t,e)})));case 2:case"end":return r.stop()}}))},locks={},lock=function(e,t){var r,n,a=arguments;return _regenerator.default.async((function(s){for(;;)switch(s.prev=s.next){case 0:return r=a.length>2&&void 0!==a[2]?a[2]:0,locks[e]||(locks[e]=Promise.resolve()),n=locks[e].then((function(){return _regenerator.default.async((function(e){for(;;)switch(e.prev=e.next){case 0:return e.abrupt("return",t());case 1:case"end":return e.stop()}}))})),locks[e]=n.catch((function(){})).then((function(){return _regenerator.default.async((function(e){for(;;)switch(e.prev=e.next){case 0:return e.abrupt("return",sleep(r));case 1:case"end":return e.stop()}}))})),s.abrupt("return",n);case 5:case"end":return s.stop()}}))},request=function e(t,r){var n,a,s,i,c=arguments;return _regenerator.default.async((function(o){for(;;)switch(o.prev=o.next){case 0:return n=c.length>2&&void 0!==c[2]?c[2]:0,a=c.length>3&&void 0!==c[3]?c[3]:2,s=c.length>4&&void 0!==c[4]?c[4]:0,o.prev=3,o.next=6,_regenerator.default.awrap(lock("request",(function(){return _regenerator.default.async((function(e){for(;;)switch(e.prev=e.next){case 0:return e.abrupt("return",fetch(t,r));case 1:case"end":return e.stop()}}))})));case 6:if(200===(i=o.sent).status){o.next=9;break}throw new Error("Request failure: status ".concat(i.status.toString()));case 9:return o.abrupt("return",i);case 12:if(o.prev=12,o.t0=o.catch(3),!(s>=a)){o.next=16;break}throw o.t0;case 16:return o.next=18,_regenerator.default.awrap(sleep(n+1e3));case 18:return o.abrupt("return",e(t,r,n,a,s+1));case 19:case"end":return o.stop()}}),null,null,[[3,12]])},satoshiConversion=1e8,transactionFee=5430,blockchainApiURL="https://blockchain.info/",blockchainWebSocketURL="wss://ws.blockchain.info/inv",blockchainAPI=function(e){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return!1!==t.cors&&(t.cors=!0),"".concat(blockchainApiURL+e,"?").concat(Object.keys(t).map((function(e){return"".concat(e,"=").concat(t[e])})).join("&"))},blockchainAPIRequest=function(e,t){return _regenerator.default.async((function(r){for(;;)switch(r.prev=r.next){case 0:return r.abrupt("return",request(blockchainAPI(e,t),void 0,1e4).then((function(e){return _regenerator.default.async((function(t){for(;;)switch(t.prev=t.next){case 0:return t.abrupt("return",e.json());case 1:case"end":return t.stop()}}))})));case 1:case"end":return r.stop()}}))},getExchangeRates=function(){var e,t;return _regenerator.default.async((function(r){for(;;)switch(r.prev=r.next){case 0:return r.next=2,_regenerator.default.awrap(blockchainAPIRequest("ticker"));case 2:for(t in e=r.sent)e[t]=e[t].last;return e.BTC=1,r.abrupt("return",e);case 6:case"end":return r.stop()}}))},Wallet=function(){function e(){var t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};if((0,_classCallCheck2.default)(this,e),t instanceof e)return this.address=t.address,this.isReadOnly=t.isReadOnly,this.localCurrency=t.localCurrency,this.key=t.key,this.originatingTransactions=t.originatingTransactions,void(this.subjects={});this.localCurrency=t.localCurrency||"BTC";var r="string"==typeof t.key?new BitcorePrivateKey(t.key,"livenet").toBuffer():t.key instanceof Uint8Array?t.key:void 0;if(r?this.key=BitcorePrivateKey.fromObject({bn:r,compressed:!t.uncompressedPublicKey,network:"livenet"}):t.address||(this.key=new BitcorePrivateKey(void 0,"livenet")),this.isReadOnly=void 0===this.key,this.address=this.isReadOnly?t.address:this.key.toAddress().toString(),this.originatingTransactions={},this.subjects={},!addressIsValid(this.address))throw new Error("Invalid Address: ".concat(this.address,"."))}return(0,_createClass2.default)(e,[{key:"_friendlyTransaction",value:function(e,t){var r={},n={},a={amount:void 0,valueInLocal:e.inputs.map((function(e){return e.prev_out.value})).reduce((function(e,t){return e+t}))*t,valueOutLocal:e.out.map((function(e){return e.value})).reduce((function(e,t){return e+t}))*t,wasSentByMe:!1};a.amount=a.valueOutLocal;var s=!0,i=!1,c=void 0;try{for(var o,u=e.inputs.map((function(e){return e.prev_out}))[Symbol.iterator]();!(s=(o=u.next()).done);s=!0){var l=o.value;a.wasSentByMe=a.wasSentByMe||l.addr===this.address,l.valueLocal=l.value*t,r[l.addr]=!0}}catch(e){i=!0,c=e}finally{try{s||null==u.return||u.return()}finally{if(i)throw c}}var d=!0,f=!1,h=void 0;try{for(var p,v=e.out[Symbol.iterator]();!(d=(p=v.next()).done);d=!0){var y=p.value;y.valueLocal=y.value*t,y.addr&&(r[y.addr]?a.amount-=y.valueLocal:n[y.addr]=!0)}}catch(e){f=!0,h=e}finally{try{d||null==v.return||v.return()}finally{if(f)throw h}}return{amount:parseFloat((a.amount/satoshiConversion).toFixed(8)),baseTransaction:e,id:e.txid,isConfirmed:(e.confirmations||0)>=6,recipients:Object.keys(n),senders:Object.keys(r),timestamp:1e3*e.time,wasSentByMe:a.wasSentByMe}}},{key:"_friendlyTransactions",value:function(e){var t,r,n,a,s,i,c=this;return _regenerator.default.async((function(o){for(;;)switch(o.prev=o.next){case 0:return o.next=2,_regenerator.default.awrap(Promise.all([e,this._getExchangeRates()]));case 2:return t=o.sent,r=(0,_slicedToArray2.default)(t,2),n=r[0].txs,a=void 0===n?[]:n,s=r[1],i=s[this.localCurrency],o.abrupt("return",a.map((function(e){return c._friendlyTransaction(e,i)})));case 9:case"end":return o.stop()}}),null,this)}},{key:"_getExchangeRates",value:function(){return _regenerator.default.async((function(e){for(;;)switch(e.prev=e.next){case 0:return e.abrupt("return","BTC"===this.localCurrency?{BTC:1}:getExchangeRates());case 1:case"end":return e.stop()}}),null,this)}},{key:"_watchTransactions",value:function(){var e=this,t="_watchTransactions ".concat(this.address);if(!this.subjects[t]){var r=new Subject;this.subjects[t]=r;var n=new WebSocket(blockchainWebSocketURL);n.onopen=function(){n.send(JSON.stringify({op:"addr_sub",addr:e.address}))},n.onmessage=function(e){var t;try{t=JSON.parse(e.data).x.hash}catch(e){}t&&r.next(t)}}return this.subjects[t]}},{key:"createTransaction",value:function(e,t){var r,n,a,s,i,c,o,u,l,d,f,h,p=this;return _regenerator.default.async((function(v){for(;;)switch(v.prev=v.next){case 0:if(!this.isReadOnly){v.next=2;break}throw new Error("Read-only wallet");case 2:return v.next=4,_regenerator.default.awrap(Promise.all([this.getBalance(),blockchainAPIRequest("unspent",{active:this.address}).catch((function(){return{unspent_outputs:[]}}))]));case 4:if(r=v.sent,n=(0,_slicedToArray2.default)(r,2),a=n[0],s=n[1],i=((s||{}).unspent_outputs||[]).map((function(e){return{outputIndex:e.tx_output_n,satoshis:e.value,scriptPubKey:e.script,txid:e.tx_hash_big_endian}})),!((t/=a._exchangeRates[this.localCurrency])>a.btc)){v.next=12;break}throw new Error("Insufficient funds");case 12:for(c=!0,o=!1,u=void 0,v.prev=15,l=i[Symbol.iterator]();!(c=(d=l.next()).done);c=!0)f=d.value,this.originatingTransactions[f.txid]&&!f.confirmations&&(f.confirmations=1);v.next=23;break;case 19:v.prev=19,v.t0=v.catch(15),o=!0,u=v.t0;case 23:v.prev=23,v.prev=24,c||null==l.return||l.return();case 26:if(v.prev=26,!o){v.next=29;break}throw u;case 29:return v.finish(26);case 30:return v.finish(23);case 31:return h=function r(n){try{return(new BitcoreTransaction).from(i.map((function(e){return new BitcoreTransaction.UnspentOutput(e)}))).to(e.address?e.address:e.getAddress?e.getAddress().toString():e,Math.floor(t*satoshiConversion)).change(p.address).fee(transactionFee).sign(p.key)}catch(e){if(n<100&&e.message.includes("totalNeededAmount"))return t-=5e-6,r(n+1);throw e}},v.abrupt("return",h(0));case 33:case"end":return v.stop()}}),null,this,[[15,19,23,31],[24,,26,30]])}},{key:"getBalance",value:function(){var e,t,r,n,a;return _regenerator.default.async((function(s){for(;;)switch(s.prev=s.next){case 0:return s.next=2,_regenerator.default.awrap(Promise.all([blockchainAPIRequest("balance",{active:this.address}),this._getExchangeRates()]));case 2:e=s.sent,t=(0,_slicedToArray2.default)(e,2),r=t[0],n=t[1],a=0;try{a=r[this.address].final_balance/satoshiConversion}catch(e){}return s.abrupt("return",{_exchangeRates:n,btc:a,local:parseFloat((a*(n[this.localCurrency]||0)).toFixed(2))});case 9:case"end":return s.stop()}}),null,this)}},{key:"getTransactionHistory",value:function(){return _regenerator.default.async((function(e){for(;;)switch(e.prev=e.next){case 0:return e.abrupt("return",this._friendlyTransactions(blockchainAPIRequest("rawaddr/".concat(this.address))));case 1:case"end":return e.stop()}}),null,this)}},{key:"send",value:function(e,t){var r,n,a;return _regenerator.default.async((function(s){for(;;)switch(s.prev=s.next){case 0:return s.next=2,_regenerator.default.awrap(this.createTransaction(e,t));case 2:return r=s.sent,n=r.id,this.originatingTransactions[n]=!0,(a=new FormData).append("tx",r.serialize()),s.abrupt("return",request(blockchainAPI("pushtx"),{body:a,method:"POST"}).then((function(e){return _regenerator.default.async((function(t){for(;;)switch(t.prev=t.next){case 0:return t.abrupt("return",e.text());case 1:case"end":return t.stop()}}))})));case 8:case"end":return s.stop()}}),null,this)}},{key:"watchNewTransactions",value:function(){var e=this,t=!(arguments.length>0&&void 0!==arguments[0])||arguments[0],r="watchNewTransactions ".concat(this.address);return this.subjects[r]||(this.subjects[r]=this._watchTransactions().pipe(mergeMap((function(t){return _regenerator.default.async((function(n){for(;;)switch(n.prev=n.next){case 0:return n.abrupt("return",lock(r,(function(){return _regenerator.default.async((function(r){for(;;)switch(r.prev=r.next){case 0:return r.next=2,_regenerator.default.awrap(e._friendlyTransactions(blockchainAPIRequest("rawtx/".concat(t)).then((function(e){return[e]}))));case 2:return r.abrupt("return",r.sent[0]);case 3:case"end":return r.stop()}}))})));case 1:case"end":return n.stop()}}))})))),t?this.subjects[r]:this.subjects[r].pipe(map((function(e){return e.filter((function(e){return e.isConfirmed}))})))}},{key:"watchTransactionHistory",value:function(){var e=this,t=!(arguments.length>0&&void 0!==arguments[0])||arguments[0],r="watchTransactionHistory ".concat(this.address);if(!this.subjects[r]){var n=new ReplaySubject(1);this.subjects[r]=n,this.getTransactionHistory().then((function(t){n.next(t),e._watchTransactions().pipe(mergeMap((function(){return _regenerator.default.async((function(t){for(;;)switch(t.prev=t.next){case 0:return t.abrupt("return",lock(r,(function(){return _regenerator.default.async((function(t){for(;;)switch(t.prev=t.next){case 0:return t.abrupt("return",e.getTransactionHistory());case 1:case"end":return t.stop()}}))})));case 1:case"end":return t.stop()}}))}))).subscribe(n)})).catch((function(t){e.subjects[r].error(t)}))}return t?this.subjects[r]:this.subjects[r].pipe(map((function(e){return e.filter((function(e){return e.isConfirmed}))})))}}]),e}(),simplebtc={getExchangeRates:getExchangeRates,minimumTransactionAmount:BitcoreTransaction.DUST_AMOUNT/satoshiConversion,transactionFee:transactionFee/satoshiConversion,Wallet:Wallet};simplebtc.simplebtc=simplebtc,module.exports=simplebtc;