pragma solidity ^0.6.2;

// Aave aToken interface
interface IAToken {
    function redeem(uint256 _amount) external;
    function balanceOf(address owner) external view returns (uint256);
    function scaledBalanceOf(address _user) external view returns (uint256);
}
