pragma solidity ^0.6.2;

interface IWETH {

  function deposit() external payable;

  function withdraw(uint256 amount) external;

}
