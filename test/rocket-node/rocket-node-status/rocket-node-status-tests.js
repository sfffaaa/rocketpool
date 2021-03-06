const os = require('os');

import { printTitle, assertThrows }  from '../../_lib/utils/general';
import { RocketPool, RocketSettings, Casper }  from '../../_lib/artifacts';
import { initialiseMiniPool } from '../../rocket-user/rocket-user-utils';
import { sendDeployValidationContract } from '../../_lib/smart-node/validation-code-contract-compiled';
import { scenarioIncrementEpochAndInitialise } from '../../casper/casper-scenarios';
import { scenarioRegisterNode } from '../rocket-node-admin/rocket-node-admin-scenarios';
import { scenarioNodeCheckin } from './rocket-node-status-scenarios';
import { scenarioNodeLogout, scenarioNodeLogoutForWithdrawal } from '../rocket-node-validator/rocket-node-validator-scenarios';
import { CasperInstance, casperEpochInitialise, casperEpochIncrementAmount } from '../../_lib/casper/casper';

export default function({owner}) {

    // Node details
    const nodeFirstProviderID = 'aws';
    const nodeFirstSubnetID = 'nvirginia';
    const nodeFirstInstanceID = 'i-1234567890abcdef5';
    const nodeFirstRegionID = 'usa-east';
    const nodeSecondProviderID = 'rackspace';
    const nodeSecondSubnetID = 'ohio';
    const nodeSecondInstanceID = '4325';
    const nodeSecondRegionID = 'usa-east';

    // Gas costs
    const nodeRegisterGas = 1600000;
    const nodeVotingGas = 1600000;
    const nodeLogoutGas = 1600000;


    contract('RocketNodeStatus - Launching minipools', async (accounts) => {

        /**
         * Config
         */

        // Node addresses
        const nodeFirst = accounts[8];
        const nodeSecond = accounts[9];
        const nodeThird = accounts[7];
        const nodeFourth = accounts[6];

        // User addresses
        const userFirst = accounts[1];
        const userSecond = accounts[2];

        // Minipools
        let miniPools = {};

        // Contract dependencies
        let rocketSettings;
        let rocketPool;
        let casper;
        before(async () => {

            // Initalise contracts
            rocketSettings = await RocketSettings.deployed();
            rocketPool = await RocketPool.deployed();
            casper = await CasperInstance();           

            // Initialise minipools
            miniPools.first = await initialiseMiniPool({fromAddress: userFirst});

            // register first node
            let validationFirstTx = await sendDeployValidationContract(nodeFirst);
            let nodeFirstValCodeAddress = validationFirstTx.contractAddress;
            await scenarioRegisterNode({
                nodeAddress: nodeFirst,
                valCodeAddress: nodeFirstValCodeAddress,
                providerID: nodeFirstProviderID,
                subnetID: nodeFirstSubnetID,
                instanceID: nodeFirstInstanceID,
                regionID: nodeFirstRegionID,
                fromAddress: owner,
                gas: nodeRegisterGas
            }); 
            
            await casperEpochInitialise(owner);

        });

        // Check to make sure countdown is enforced
        it(printTitle('registered node', 'checkin - initially minipools should not launch as the countdown has not passed'), async () => {

            // Mine to an epoch for Casper
            await casperEpochIncrementAmount(owner, 1);

            // Get average CPU load
            // Our average load is determined by average load / CPU cores since it is relative to how many cores there are in a system
            // Also Solidity doesn't deal with decimals atm, so convert to a whole wei number for the load
            let averageLoad15mins = web3.toWei(os.loadavg()[2] / os.cpus().length, 'ether');

            // Perform checkin, which shouldn't assign minipool to node because the countdown has not passed
            await scenarioNodeCheckin({
                averageLoad: averageLoad15mins,
                fromAddress: nodeFirst,
            });

            // Check node's minipool count
            let nodeMiniPoolCount = await rocketPool.getPoolsFilterWithNodeCount.call(nodeFirst);
            assert.equal(nodeMiniPoolCount.valueOf(), 0, 'No minipools should have been launched yet because countdown not passed');
        });

        // Check to make sure that after countdown minipools are launched
        it(printTitle('registered node', 'checkin - when countdown is 0, minipools are launched by assigning to node and sending balance to Casper'), async () => {

            // precheck minipool balance                
            let miniPoolBalance = web3.eth.getBalance(miniPools.first.address);
            assert.isAbove(miniPoolBalance, 0);
            
            // Set our pool launch timer to 0 setting so that will trigger its launch now rather than waiting for it to naturally pass - only an owner operation
            await rocketSettings.setMiniPoolCountDownTime(0, {from: web3.eth.coinbase, gas: 500000});

            // Mine to an epoch for Casper
            await casperEpochIncrementAmount(owner, 1);

            // Get average CPU load
            // Our average load is determined by average load / CPU cores since it is relative to how many cores there are in a system
            // Also Solidity doesn't deal with decimals atm, so convert to a whole wei number for the load
            let averageLoad15mins = web3.toWei(os.loadavg()[2] / os.cpus().length, 'ether');
            // Perform checkin, to assign the minipool to the node for launch
            await scenarioNodeCheckin({
                averageLoad: averageLoad15mins,
                fromAddress: nodeFirst,
            });

            // Check node's attached minipools
            let nodeMiniPoolsAttached = await rocketPool.getPoolsFilterWithNode.call(nodeFirst);
            let nodeMiniPoolBalance = web3.eth.getBalance(miniPools.first.address).valueOf();
            let nodeMiniPoolStatus = await miniPools.first.getStatus.call();
            assert.equal(nodeMiniPoolsAttached.length, 1, 'Invalid number of minipools attached to node');
            assert.equal(nodeMiniPoolsAttached[0], miniPools.first.address, 'Invalid address of minipool attached to node');
            assert.equal(nodeMiniPoolBalance, 0, 'Invalid attached minipool balance');
            assert.equal(nodeMiniPoolStatus.valueOf(), 2, 'Invalid attached minipool status - should be staking');           
            
            // Check it's a validator in casper
            let casperValidatorIndex = await casper.methods.validator_indexes(miniPools.first.address).call({from: owner});
            assert.equal(casperValidatorIndex.valueOf(), 1, 'Invalid validator index');
        });
        
        // Check to make sure multiple minipools get launched
        it(printTitle('registered node', 'checkin - launch multiple minipools'), async () => {
            miniPools.second = await initialiseMiniPool({fromAddress: userFirst});
            miniPools.third = await initialiseMiniPool({fromAddress: userFirst});

            // Set our pool launch timer to 0 setting so that will trigger its launch now rather than waiting for it to naturally pass - only an owner operation
            await rocketSettings.setMiniPoolCountDownTime(0, {from: web3.eth.coinbase, gas: 500000});

            // save number of attached pools to use for assertion later
            let beforeMiniPoolsAttached = await rocketPool.getPoolsFilterWithNode.call(nodeFirst);
            let beforeNumberOfPools = beforeMiniPoolsAttached.length;

             // Mine to an epoch for Casper
             await casperEpochIncrementAmount(owner, 1);

            // Get average CPU load
            // Our average load is determined by average load / CPU cores since it is relative to how many cores there are in a system
            // Also Solidity doesn't deal with decimals atm, so convert to a whole wei number for the load
            let averageLoad15mins = web3.toWei(os.loadavg()[2] / os.cpus().length, 'ether');
            // Perform checkin, to assign the minipool to the node for launch
            await scenarioNodeCheckin({
                averageLoad: averageLoad15mins,
                fromAddress: nodeFirst,
            });

            // Mine to an epoch for Casper
            await casperEpochIncrementAmount(owner, 1);

            // save number of attached pools to use for assertion later
            let afterMiniPoolsAttached = await rocketPool.getPoolsFilterWithNode.call(nodeFirst);
            let afterNumberOfPools = afterMiniPoolsAttached.length;
            assert.equal(afterNumberOfPools, beforeNumberOfPools + 1, 'First minipool was not launched');

            // Perform checkin, to assign the minipool to the node for launch
            await scenarioNodeCheckin({
                averageLoad: averageLoad15mins,
                fromAddress: nodeFirst,
            });

            // save number of attached pools to use for assertion later
            afterMiniPoolsAttached = await rocketPool.getPoolsFilterWithNode.call(nodeFirst);
            afterNumberOfPools = afterMiniPoolsAttached.length;
            assert.equal(afterNumberOfPools, beforeNumberOfPools + 2, 'Second minipool was not launched');
            
        });

        // Check that load balancing is working correctly - assigns new minipools to the node with lowest load
        it(printTitle('registered node', 'checkin - assign minipool to node with the lowest average load'), async () => {
            // Set our pool launch timer to 0 setting so that will trigger its launch now rather than waiting for it to naturally pass - only an owner operation
            await rocketSettings.setMiniPoolCountDownTime(0, {from: web3.eth.coinbase, gas: 500000});

            // register another node
            let validationSecondTx = await sendDeployValidationContract(nodeSecond);
            let nodeSecondValCodeAddress = validationSecondTx.contractAddress;
            await scenarioRegisterNode({
                nodeAddress: nodeSecond,
                valCodeAddress: nodeSecondValCodeAddress,
                providerID: nodeSecondProviderID,
                subnetID: nodeSecondSubnetID,
                instanceID: nodeSecondInstanceID,
                regionID: nodeSecondRegionID,
                fromAddress: owner,
                gas: nodeRegisterGas
            });

             // Mine to an epoch for Casper
             await casperEpochIncrementAmount(owner, 1);

            // set load for first node
            let firstNodeLoad = 0.5; // high load
            let firstNodeLoadWei = web3.toWei(firstNodeLoad, 'ether');
            await scenarioNodeCheckin({
                averageLoad: firstNodeLoadWei,
                fromAddress: nodeFirst,
            });

            // Mine to an epoch for Casper
            await casperEpochIncrementAmount(owner, 1);

            // set load for second node
            let secondNodeLoad = 0.1; // low load
            let secondNodeLoadWei = web3.toWei(secondNodeLoad, 'ether');
            await scenarioNodeCheckin({
                averageLoad: secondNodeLoadWei,
                fromAddress: nodeSecond,
            });

            // save number of attached pools to use for assertion later
            let firstNodePoolsBefore = await rocketPool.getPoolsFilterWithNode.call(nodeFirst);
            let firstNodePoolsBeforeNumber = firstNodePoolsBefore.length;
            let secondNodePoolsBefore = await rocketPool.getPoolsFilterWithNode.call(nodeSecond);
            let secondNodePoolsBeforeNumber = secondNodePoolsBefore.length;

            // initialise a minipool for assignment
            miniPools.fourth = await initialiseMiniPool({fromAddress: userFirst});

            // Mines to an epoch start block so that we can launch the minipool (deposit into Casper)
            await casperEpochIncrementAmount(owner, 1);

            // perform checkin to launch minipool
            await scenarioNodeCheckin({
                averageLoad: firstNodeLoadWei,
                fromAddress: nodeFirst,
            });

            // minipool should have been attached to second node because it has the lowest load
            let secondNodePoolsAfter = await rocketPool.getPoolsFilterWithNode.call(nodeSecond);
            let secondNodePoolsAfterNumber = secondNodePoolsAfter.length;
            assert.equal(secondNodePoolsAfterNumber, secondNodePoolsBeforeNumber + 1, 'Minipool didnt get assigned to second node even though it has the lowest load');

            miniPools.fifth = await initialiseMiniPool({fromAddress: userFirst});

            // set load for first node to be lower than second node
            firstNodeLoad = 0.01; // high load
            firstNodeLoadWei = web3.toWei(firstNodeLoad, 'ether');

            // Mine to an epoch for Casper
            await casperEpochIncrementAmount(owner, 1);

            // perform checkin to launch minipool
            await scenarioNodeCheckin({
                averageLoad: firstNodeLoadWei,
                fromAddress: nodeFirst,
            });

            // minipool should have been assigned to the first node because it has the lowest load
            let firstNodePoolsAfter = await rocketPool.getPoolsFilterWithNode.call(nodeFirst);
            let firstNodePoolsAfterNumber = firstNodePoolsAfter.length;
            assert.equal(firstNodePoolsAfterNumber, firstNodePoolsBeforeNumber + 1, 'Minipool didnt get assigned to first node even though it has the lowest load');

        });

        // Random address cannot perform checkin as a node
        it(printTitle('random address', 'checkin - cannot checkin as a node'), async () => {

            // Mine to an epoch for Casper
            await casperEpochIncrementAmount(owner, 1);

            // Get average CPU load
            let averageLoad15mins = web3.toWei(os.loadavg()[2] / os.cpus().length, 'ether');

            // Perform checkin
            await assertThrows(scenarioNodeCheckin({
                averageLoad: averageLoad15mins,
                fromAddress: userFirst,
            }));

        });
    });

    contract('RocketNodeStatus - Withdrawal', async (accounts) => {

        /**
         * Config
         */

        // Node addresses
        const nodeFirst = accounts[8];
        const nodeSecond = accounts[9];
        const nodeThird = accounts[7];
        const nodeFourth = accounts[6];

        // User addresses
        const userFirst = accounts[1];
        const userSecond = accounts[2];

        // Minipools
        let miniPools = {};

        // Contract dependencies
        let rocketSettings;
        let rocketPool;
        let casper;
        before(async () => {

            // Initalise contracts
            rocketSettings = await RocketSettings.deployed();
            rocketPool = await RocketPool.deployed();
            casper = await CasperInstance();

            // Initialise Casper epoch to current block number
            await casperEpochInitialise(owner);

            // Mine to an epoch starting block for Casper
            await casperEpochIncrementAmount(owner, 1);

            // Initialise minipools
            miniPools.first = await initialiseMiniPool({fromAddress: userFirst});
            miniPools.second = await initialiseMiniPool({fromAddress: userSecond});

            // register first node
            let validationFirstTx = await sendDeployValidationContract(nodeFirst);
            let nodeFirstValCodeAddress = validationFirstTx.contractAddress;
            await scenarioRegisterNode({
                nodeAddress: nodeFirst,
                valCodeAddress: nodeFirstValCodeAddress,
                providerID: nodeFirstProviderID,
                subnetID: nodeFirstSubnetID,
                instanceID: nodeFirstInstanceID,
                regionID: nodeFirstRegionID,
                fromAddress: owner,
                gas: nodeRegisterGas
            });

            // Set our pool launch timer to 0 setting so that will trigger its launch now rather than waiting for it to naturally pass - only an owner operation
            await rocketSettings.setMiniPoolCountDownTime(0, {from: web3.eth.coinbase, gas: 500000});

            // Get average CPU load
            // Our average load is determined by average load / CPU cores since it is relative to how many cores there are in a system
            // Also Solidity doesn't deal with decimals atm, so convert to a whole wei number for the load
            let averageLoad15mins = web3.toWei(os.loadavg()[2] / os.cpus().length, 'ether');

            // Mine to an epoch starting block for Casper
            await casperEpochIncrementAmount(owner, 1);

            // Perform checkin, to assign the first minipool to the node for launch
            await scenarioNodeCheckin({
                averageLoad: averageLoad15mins,
                fromAddress: nodeFirst,
            });

            // Perform checkin, to assign the second minipool to the node for launch
            await scenarioNodeCheckin({
                averageLoad: averageLoad15mins,
                fromAddress: nodeFirst,
            });

            // Mine to an epoch starting block for Casper
            await casperEpochIncrementAmount(owner, 2);        

        });

        it(printTitle('registered node', 'checkin - automatically withdraws funds from Casper (into minipool) after staking & logging out'), async () => {

            // Precheck the minipool balance to make sure it has been deposited with Casper
            let nodeMiniPoolBalanceBefore = web3.eth.getBalance(miniPools.first.address);            
            assert.isTrue(nodeMiniPoolBalanceBefore.valueOf() == 0, 'Invalid attached minipool balance precheck');

            // Set the minipool staking duration to 0 for testing so it will attempt to request logout from Casper
            await rocketPool.setPoolStakingDuration(miniPools.first.address, 0, { from: owner, gas: 150000 });      

            // Mine to an epoch starting block for Casper
            await casperEpochInitialise(owner);
            await casperEpochIncrementAmount(owner, 1);

            await scenarioNodeLogoutForWithdrawal({
                owner: owner,
                validators: [
                    {nodeAddress: nodeFirst, minipoolAddress: miniPools.first.address},
                    {nodeAddress: nodeFirst, minipoolAddress: miniPools.second.address}
                ],
                nodeAddress: nodeFirst,
                minipoolAddress: miniPools.first.address,
                gas: nodeLogoutGas
            });

            await casperEpochIncrementAmount(owner, 1);

            // Check attached minipool has withdrawn deposit from casper
            let nodeMiniPoolStatus = await miniPools.first.getStatus.call();
            assert.equal(nodeMiniPoolStatus.valueOf(), 4, 'Invalid attached minipool status');
            let nodeMiniPoolBalance = web3.eth.getBalance(miniPools.first.address);            
            assert.isTrue(nodeMiniPoolBalance.valueOf() > 0, 'Invalid attached minipool balance');

            // Check other minipool is still staking
            let otherMiniPoolStatus = await miniPools.second.getStatus.call();
            assert.equal(otherMiniPoolStatus.valueOf(), 2, 'Invalid other minipool status');
            let otherMiniPoolBalance = web3.eth.getBalance(miniPools.second.address);            
            assert.equal(otherMiniPoolBalance.valueOf(), 0, 'Invalid other minipool balance');

        });

    });


}