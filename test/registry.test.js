/* global it, contract, artifacts, assert, web3 */
const { deployProxy} = require('@openzeppelin/truffle-upgrades')

const WithdrawalPool = artifacts.require('./WithdrawalPool.sol')
const MasterTransferRegistry = artifacts.require('./MasterTransferRegistry.sol')
const MintableERC20 = artifacts.require('./MintableERC20.sol')
const MockWETH = artifacts.require('./MockWETH.sol')

const factoryJson = require('@uniswap/v2-core/build/UniswapV2Factory.json')
const pairJson = require('@uniswap/v2-core/build/UniswapV2Pair.json')
const contractInit = require('@truffle/contract')
const UniswapV2Factory = contractInit(factoryJson)
const UniswapV2Pair = contractInit(pairJson)
UniswapV2Factory.setProvider(web3.currentProvider)
UniswapV2Pair.setProvider(web3.currentProvider)

const catchRevert = require('./helpers/exceptions').catchRevert
const { moveForwardTime, getRandomSalt, assertEventOfType } = require('./helpers/utils')
const BN = web3.utils.BN
const _1e18 = new BN('1000000000000000000')

contract('MasterTransferRegistry', (accounts) => {

  let uni, pool, weth, nectar, registry, factory

  beforeEach('redeploy contract', async function () {
    weth = await MockWETH.new()
    nectar = await MintableERC20.new('Nectar', 'NEC')

    factory = await UniswapV2Factory.new(accounts[0], { from: accounts[0] })

    const tx = await factory.createPair(weth.address, nectar.address, { from: accounts[0] })
    assertEventOfType(tx, 'PairCreated', 0)
    uni = await UniswapV2Pair.at(tx.logs[0].args.pair)

    await weth.deposit({ value: _1e18.mul(new BN(8)), from: accounts[0] })
    await nectar.mint(accounts[0], _1e18.mul(new BN(10000)))
    await weth.transfer(uni.address, _1e18.mul(new BN(4)))
    await nectar.transfer(uni.address, _1e18.mul(new BN(5000)))
    await uni.mint(accounts[0], { from: accounts[0] })

    registry = await deployProxy(MasterTransferRegistry, [factory.address, weth.address, nectar.address, accounts[9]])
    await registry.createNewPool(weth.address)
    await weth.deposit({ value: _1e18.mul(new BN(8)), from: accounts[1] })
    const poolAddress = await registry.tokenPools(weth.address)
    pool = await WithdrawalPool.at(poolAddress)

    const depositAmount = _1e18.mul(new BN(8))
    await weth.approve(pool.address, depositAmount, { from: accounts[1] })
    await pool.joinPool(depositAmount, { from: accounts[1] })

    await moveForwardTime(86400)
    await weth.transfer(uni.address, _1e18.div(new BN(10)).mul(new BN(4)))
    await nectar.transfer(uni.address, _1e18.mul(new BN(500)))
    await uni.mint(accounts[0], { from: accounts[0] })

    await registry.updateExchangeRate(nectar.address)
    const price = await registry.necExchangeRate(weth.address, _1e18)
    const expectedRatio = new BN(1250)
    assert.equal(price.toString(), _1e18.mul(expectedRatio).toString(), 'Price was not updated')
  })

  it('deploy: transfer registry gets deployed and has correct identifier', async () => {
    const name = await registry.identify()
    assert.equal(name, 'DeversiFi_MTR_v0.0.1', 'Name not set')
  })

  it('transferForDeversifiWithdrawals: cannot transfer more than deposited in the weth pool', async () => {
    const transferAmount = _1e18.mul(new BN(9))
    await catchRevert(registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt()))
  })

  it('transferForDeversifiWithdrawals: cannot transfer if no NEC staked', async () => {
    const transferAmount = _1e18.mul(new BN(4))
    await catchRevert(registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt()))
  })

  it('transferForDeversifiWithdrawals: can transfer weth from pool if NEC staked and below available limit', async () => {
    const stakeAmount = _1e18.mul(new BN(100000))
    await nectar.mint(accounts[0], stakeAmount)
    await nectar.approve(registry.address, stakeAmount)
    await registry.stakeNECCollateral(stakeAmount)

    const balanceStart = await weth.balanceOf(pool.address)

    const transferAmount = _1e18.div(new BN(10)).mul(new BN(5))
    const transferAmountAfterFee = transferAmount.mul(new BN(999)).div(new BN(1000))
    await registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt())

    const balanceAfter = await weth.balanceOf(pool.address)

    assert.equal(balanceStart.toString(), balanceAfter.add(transferAmountAfterFee).toString(), 'Amount not transfered')
  })

  it('transferForDeversifiWithdrawals: cannot transfer more weth than is available in pool', async () => {
    const stakeAmount = _1e18.mul(new BN(1000000000000))
    await nectar.mint(accounts[0], stakeAmount)
    await nectar.approve(registry.address, stakeAmount)
    await registry.stakeNECCollateral(stakeAmount)

    const transferAmount = _1e18.mul(new BN(20))
    await catchRevert(registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt()))
  })

  it('transferForDeversifiWithdrawals: can transfer Eth using Weth pool if NEC staked and below available limit', async () => {
    const stakeAmount = _1e18.mul(new BN(100000))
    await nectar.mint(accounts[0], stakeAmount)
    await nectar.approve(registry.address, stakeAmount)
    await registry.stakeNECCollateral(stakeAmount)

    const balanceStart = await weth.balanceOf(pool.address)
    const ethBalanceStart = await web3.eth.getBalance(accounts[5])

    const transferAmount = _1e18.div(new BN(10)).mul(new BN(5))
    const transferAmountAfterFee = transferAmount.mul(new BN(999)).div(new BN(1000))
    await registry.transferForDeversifiWithdrawals('0x0000000000000000000000000000000000000000', accounts[5], transferAmount, getRandomSalt())

    const balanceAfter = await weth.balanceOf(pool.address)
    const ethBalanceAfter = await web3.eth.getBalance(accounts[5])

    assert.equal(balanceStart.toString(), balanceAfter.add(transferAmountAfterFee).toString(), 'Amount not transfered')

    assert.equal((new BN(ethBalanceStart)).add(transferAmountAfterFee).toString(), ethBalanceAfter.toString(), 'Amount not transfered')
  })

  it('repay: can repay weth from pool to set lentSupply back to zero', async () => {
    const stakeAmount = _1e18.mul(new BN(100000))
    await nectar.mint(accounts[0], stakeAmount)
    await nectar.approve(registry.address, stakeAmount)
    await registry.stakeNECCollateral(stakeAmount)

    const balanceStart = await weth.balanceOf(pool.address)

    const transferAmount = _1e18.div(new BN(10)).mul(new BN(5))
    const transferAmountAfterFee = transferAmount.mul(new BN(999)).div(new BN(1000))
    await registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt())

    const balanceAfter = await weth.balanceOf(pool.address)

    assert.equal(balanceStart.toString(), balanceAfter.add(transferAmountAfterFee).toString(), 'Amount not transfered')

    assert.equal((await registry.lentSupply(weth.address)).toString(), transferAmount.toString(), 'Lent amount not recorded correctly')

    await weth.approve(registry.address, transferAmount)
    await registry.repayToPool(weth.address, transferAmount)

    assert.equal((await registry.lentSupply(weth.address)).toString(), '0', 'Lent amount not cleared after repay')
  })

  it('unstakeNECCollateral: cannot unstake NEC used to insure lent funds', async () => {
    const stakeAmount = _1e18.mul(new BN(100000))
    await nectar.mint(accounts[0], stakeAmount)
    await nectar.approve(registry.address, stakeAmount)
    await registry.stakeNECCollateral(stakeAmount)

    const transferAmount = _1e18.div(new BN(10)).mul(new BN(5))
    await registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt())

    assert.equal((await registry.lentSupply(weth.address)).toString(), transferAmount.toString(), 'Lent amount not recorded correctly')

    // Can't withdraw all
    await catchRevert(registry.unstakeNECCollateral(stakeAmount))

    // Can withdraw nearly all
    const requiredRemainingStake = transferAmount.mul(new BN(1250)).mul(new BN(2))
    await registry.unstakeNECCollateral(stakeAmount.sub(requiredRemainingStake))

    // Cannot withdraw any more
    await catchRevert(registry.unstakeNECCollateral(transferAmount))
  })

  it('setTransferFee: cannot set the transfer fee above 1%', async () => {
    await registry.setTransferFee(9900)

    await catchRevert(registry.setTransferFee(9899))
  })

  it('setTransferFee: cannot set the transfer fee below 0%', async () => {
    await registry.setTransferFee(10000)

    await catchRevert(registry.setTransferFee(10001))
  })

  it('setAvailabilityPercentage: cannot set the availability percentage above 100%', async () => {
    await registry.setAvailabilityPercentage(90)

    await registry.setAvailabilityPercentage(100)

    await catchRevert(registry.setAvailabilityPercentage(101))
  })

  it('allPoolsLentSupplyEquivNEC: check always updated to correct values after each transfer', async () => {
    let lentSupplyEquivNEC

    const stakeAmount = _1e18.mul(new BN(100000))
    await nectar.mint(accounts[0], stakeAmount)
    await nectar.approve(registry.address, stakeAmount)
    await registry.stakeNECCollateral(stakeAmount)

    const transferAmount = _1e18.div(new BN(10)).mul(new BN(5))
    await registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt())

    lentSupplyEquivNEC = (await registry.allPoolsLentSupplyEquivNEC()).toString()

    assert.equal(lentSupplyEquivNEC, transferAmount.mul(new BN(1250)).toString(), 'Lent supply in NEC not recorded correctly')

    await weth.approve(registry.address, transferAmount)
    await registry.repayToPool(weth.address, transferAmount)

    lentSupplyEquivNEC = (await registry.allPoolsLentSupplyEquivNEC()).toString()
    assert.equal(lentSupplyEquivNEC, transferAmount.mul(new BN(1250)).toString(), 'Lent supply in NEC not recorded correctly')

    await registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt())

    lentSupplyEquivNEC = (await registry.allPoolsLentSupplyEquivNEC()).toString()
    assert.equal(lentSupplyEquivNEC, transferAmount.mul(new BN(1250)).toString(), 'Lent supply in NEC not recorded correctly')

    await weth.approve(registry.address, transferAmount)
    await registry.repayToPool(weth.address, transferAmount.div(new BN(2)))

    lentSupplyEquivNEC = (await registry.allPoolsLentSupplyEquivNEC()).toString()
    assert.equal(lentSupplyEquivNEC, transferAmount.mul(new BN(1250)).toString(), 'Lent supply in NEC not recorded correctly')

    await registry.transferForDeversifiWithdrawals(weth.address, accounts[5], transferAmount, getRandomSalt())

    lentSupplyEquivNEC = (await registry.allPoolsLentSupplyEquivNEC()).toString()
    assert.equal(lentSupplyEquivNEC, transferAmount.mul(new BN(1875)).toString(), 'Lent supply in NEC not recorded correctly')

    assert.equal((await registry.lentSupply(weth.address)).toString(), transferAmount.mul(new BN(3)).div(new BN(2)).toString(), 'Lent amount not correct')
  })

})
