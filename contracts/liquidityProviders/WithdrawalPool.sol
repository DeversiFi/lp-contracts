pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./WithdrawalPoolToken.sol";
import "./MasterTransferRegistry.sol";

contract WithdrawalPool is WithdrawalPoolToken  {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  address public poolToken;
  address public transferRegistry;
  uint256 public constant INITIAL_SUPPLY = 100 * 10 ** 18;
  uint256 public constant MINIMUM_EXIT_PERIOD = 3 hours;
  uint256 public constant MAXIMUM_EXIT_PERIOD = 36 hours;

  struct PendingExit {
    uint256 shares;
    uint256 requestTime;
  }

  mapping (address => PendingExit) public exitRequests;

  constructor (
    string memory _symbol,
    address _poolToken
  ) public WithdrawalPoolToken(_symbol, _symbol) {
    poolToken = _poolToken;
    transferRegistry = msg.sender;
    IERC20(poolToken).approve(transferRegistry, 2 ** 256 - 1);
  }

  event LogJoinedPool(
      address joiner,
      address token,
      uint256 amountToken,
      uint256 amountShares
  );

  event LogPendingExit(
      address leaver,
      address token,
      uint256 shares
  );

  event LogExit(
      address leaver,
      address token,
      uint256 amountToken,
      uint256 amountShares
  );

  event LogInsuranceClaim(
      address leaver,
      address token,
      uint256 amountToken,
      uint256 amountShares
  );

  function joinPool(uint256 amountUnderlying) public {
    uint256 totalPoolShares = totalSupply();
    uint256 newPoolShares;
    if (totalPoolSize() == 0) {
       newPoolShares = INITIAL_SUPPLY;
    } else {
       newPoolShares = totalPoolShares.mul(amountUnderlying).div(totalPoolSize());
    }
    emit LogJoinedPool(msg.sender, poolToken, amountUnderlying, newPoolShares);
    IERC20(poolToken).safeTransferFrom(msg.sender, address(this), amountUnderlying);
    _mint(msg.sender, newPoolShares);
  }

  function exitPool(uint256 amountPoolShares) public {
    _transfer(msg.sender, address(this), amountPoolShares);
    emit LogPendingExit(msg.sender, poolToken, amountPoolShares);
    exitRequests[msg.sender].shares = exitRequests[msg.sender].shares.add(amountPoolShares);
    exitRequests[msg.sender].requestTime = now;
  }

  function finaliseExit(address exiter) public returns (bool) {
    PendingExit memory pending = exitRequests[exiter];
    uint256 totalPoolShares = totalSupply();
    uint256 amountUnderlying = pending.shares.mul(totalPoolSize()).div(totalPoolShares);
    if (now > pending.requestTime + MINIMUM_EXIT_PERIOD) {
      if (totalPoolSize().sub(lentSupply()) >= amountUnderlying) {
        IERC20(poolToken).safeTransfer(exiter, amountUnderlying);
        _burn(address(this), pending.shares);
        exitRequests[exiter] = PendingExit({ shares: 0, requestTime: 0 });
        emit LogExit(exiter, poolToken, amountUnderlying, pending.shares);
        return true;
      }
    }
    if (now > pending.requestTime + MAXIMUM_EXIT_PERIOD) {
      payFromInsuranceFund(exiter, amountUnderlying);
      _burn(address(this), pending.shares);
      exitRequests[exiter] = PendingExit({ shares: 0, requestTime: 0 });
      emit LogInsuranceClaim(exiter, poolToken, amountUnderlying, pending.shares);
      return true;
    }
    return false;
  }

  function payFromInsuranceFund(address toPay, uint256 amount) internal returns (bool) {
    return MasterTransferRegistry(transferRegistry).payFromInsuranceFund(poolToken, toPay, amount);
  }

  function totalPoolSize() public view returns (uint256) {
    return IERC20(poolToken).balanceOf(address(this)) + lentSupply();
  }

  function lentSupply() internal view returns (uint256) {
    return MasterTransferRegistry(transferRegistry).lentSupply(poolToken);
  }

  function underlyingTokensOwned(address owner) public view returns (uint256) {
    return totalPoolSize().mul(balanceOf(owner)).div(totalSupply());
  }

}
