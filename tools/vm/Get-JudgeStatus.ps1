param([string]$Name = 'OOTv2-Judge')
$ErrorActionPreference = 'Stop'
Get-VM -Name $Name | Select-Object Name,State,CPUUsage,MemoryAssigned,Uptime
Get-VMNetworkAdapter -VMName $Name | Select-Object VMName,SwitchName,IPAddresses