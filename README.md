# C-Lightning Account Manager (CLAM)

This repository contains the code for the server that the lastbit mobile application (*v0*) connects to. User records are maintained on mongodb, on-chain transactions are tracked using electrum and separate user accounts are maintained with functionality to move funds between users off-chain and pay nearby invoices for merchant scenarios. 

Autopilot, Autorebalancing and allowing users to withdraw funds are experimental and should be used only in development mode.

*USE AT YOUR OWN RISK ON MAINNET* - There are several known issues with regards to concurrency, autopilot, autorebalance, locking funds, signing of user tokens and scaling with thousands of user invoices. 

These issues have been fixed and significantly more advanced enterprise grade server is currently WIP and serves the backend for the latest application on www.lastbit.io

## Usage

1. Clone
2. `npm install`
3. Install `bitcoind`, `c-lightning`. Edit `config.js` and ensure that your bitcoind, c-lightning and mongodb parameters are correct.
4. Use `pm2` or your favourite node runtime to start app.js

CLAM connects to [c-lightning](https://github.com/ElementsProject/lightning), [Blockstream's Electrum](https://github.com/Blockstream/electrs). Balance calculation logic using payment hashes and deposit addresses to track user balances is inspired from [lndhub](https://github.com/BlueWallet/LndHub).

# Automation for your lightning Node

Allow your newly created lightning node to connect automatically to some seed nodes and start creating channels with them.

(READ THE CODE UNDER AUTOPILOT, MODIFY AND USE AT YOUR OWN RISK)

## Autorebalance

Automatically rebalance your channels with outgoing capacity to 50/50 outgoing and incoming channel capacity by using the [lightning rebalance plugin](https://github.com/lightningd/plugins/tree/master/rebalance)

![Image](https://user-images.githubusercontent.com/10804169/58201232-3fb5b380-7cdd-11e9-9134-afe552781714.PNG)

#### Usage:
1. Connect from another node and fund a max capacity channel (16777215 sats) with your node.
2. Obtain the `short_channel_id ` of the created channel after status is `CHANNELD_NORMAL`
3. Run `node autorebalance <short_channel_id>`
