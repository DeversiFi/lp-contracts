/* global it, contract, artifacts, assert, web3 */
const WithdrawalPool = artifacts.require('./WithdrawalPool.sol')
const MasterTransferRegistry = artifacts.require('./MasterTransferRegistry.sol')
const MintableERC20 = artifacts.require('./MintableERC20.sol')

const factoryJson = require('@uniswap/v2-core/build/UniswapV2Factory.json')
const pairJson = require('@uniswap/v2-core/build/UniswapV2Pair.json')
const contractInit = require('@truffle/contract')
const UniswapV2Factory = contractInit(factoryJson)
const UniswapV2Pair = contractInit(pairJson)
UniswapV2Factory.setProvider(web3.currentProvider)
UniswapV2Pair.setProvider(web3.currentProvider)

function assertEventOfType (response, eventName, index) {
  assert.equal(response.logs[index].event, eventName, eventName + ' event should have fired.')
}

const catchRevert = require("./helpers/exceptions").catchRevert
const BN = web3.utils.BN
const _1e18 = new BN('1000000000000000000')

contract('WithdrawalPool', (accounts) => {

  let uni, pool, weth, nectar, registry, factory

  beforeEach('redeploy contract', async function () {
    weth = await MintableERC20.new('Wrapped_ETH', 'WETH')
    nectar = await MintableERC20.new('Nectar', 'NEC')

    factory = await UniswapV2Factory.new(accounts[0], { from: accounts[0] })

    const tx = await factory.createPair(weth.address, nectar.address, { from: accounts[0] })
    assertEventOfType(tx, 'PairCreated', 0)
    uni = await UniswapV2Pair.at(tx.logs[0].args.pair)

    await weth.mint(accounts[0], _1e18.mul(new BN(100)))
    await nectar.mint(accounts[0], _1e18.mul(new BN(100000)))
    await weth.transfer(uni.address, _1e18.mul(new BN(40)))
    await nectar.transfer(uni.address, _1e18.mul(new BN(50000)))
    await uni.mint(accounts[0], { from: accounts[0] })

    registry = await MasterTransferRegistry.new(factory.address, weth.address, nectar.address)
    await registry.createNewPool(weth.address)
    await weth.mint(accounts[1], _1e18.mul(new BN(5000)))
    const poolAddress = await registry.tokenPools(weth.address)
    pool = await WithdrawalPool.at(poolAddress)
  })

  it('deploy: pool gets deployed and has correct pool token address', async () => {
    const address = await pool.poolToken()
    const masterRegistry = await pool.transferRegistry()
    const totalPoolSize = await pool.totalPoolSize()
    assert.equal(address, weth.address, 'Pool token not set')
    assert.equal(masterRegistry, registry.address, 'Master not correctly set in pool contract')
    assert.equal(totalPoolSize, 0, 'There are already deposits?')
  })

  it('joinPool: when depositing tokens to the pool, the tokenss are transfered into the contract, and correct number of LP tokens are minted for depositor', async () => {
    const depositAmount = _1e18.mul(new BN(1000))
    await weth.approve(pool.address, depositAmount, { from: accounts[1] })
    await pool.joinPool(depositAmount, { from: accounts[1] })
    const newBalance = await weth.balanceOf(accounts[1])
    assert.equal(newBalance.toString(), _1e18.mul(new BN(5000)).sub(depositAmount).toString(), 'Token not transfered')

    const lpwethBalance = await pool.balanceOf(accounts[1])
    assert.equal(lpwethBalance.toString(), _1e18.mul(new BN(100)).toString(), 'Initial mint for first depositor was not 100')
  })

  it('joinPool: multiple depositors get credited correct ratio of LP tokens', async () => {
    const depositAmount = _1e18.mul(new BN(1000))
    await weth.transfer(accounts[2], depositAmount, { from: accounts[1] })
    await weth.transfer(accounts[3], _1e18.mul(new BN(400)), { from: accounts[1] })
    await weth.approve(pool.address, depositAmount, { from: accounts[1] })
    await weth.approve(pool.address, depositAmount, { from: accounts[2] })
    await weth.approve(pool.address, depositAmount, { from: accounts[3] })

    await pool.joinPool(depositAmount, { from: accounts[1] })
    await pool.joinPool(depositAmount, { from: accounts[2] })
    await pool.joinPool(_1e18.mul(new BN(400)), { from: accounts[3] })

    const lpTokenBalance1 = await pool.balanceOf(accounts[1])
    const lpTokenBalance2 = await pool.balanceOf(accounts[2])
    const lpTokenBalance3 = await pool.balanceOf(accounts[3])
    assert.equal(lpTokenBalance1.toString(), _1e18.mul(new BN(100)).toString(), 'Initial mint for first depositor was not 100')
    assert.equal(lpTokenBalance2.toString(), _1e18.mul(new BN(100)).toString(), 'Second depositor not give LP tokens at correct ratio')
    assert.equal(lpTokenBalance3.toString(), _1e18.mul(new BN(40)).toString(), 'Third depositor not give LP tokens at correct ratio')
  })

  it('exitPool: LP tokens are destroyed and proportional share of pool withdrawn', async () => {

  })

})
