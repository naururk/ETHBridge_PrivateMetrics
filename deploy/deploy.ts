// deploy/00_deploy_MetricsHub.ts
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

/** +30% к рекомендации или фолбек (gwei → wei) */
const bump = (v: bigint | null | undefined, fallbackGwei: number) =>
  v && v > 0n ? (v * 13n) / 10n : BigInt(Math.floor(fallbackGwei)) * 10n ** 9n;

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts, artifacts, ethers, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  // Инфо о контракте/сети
  const art = await artifacts.readArtifact("MetricsHub");
  const ctor = (art.abi as any[]).find((x) => x.type === "constructor");
  log(`Contract: MetricsHub | Constructor inputs: ${ctor?.inputs?.length ?? 0}`);
  log(`Args: []`);
  log(`Network: ${network.name}`);

  // 1) газовые рекомендации
  const fee = await ethers.provider.getFeeData(); // { maxFeePerGas, maxPriorityFeePerGas }

  // 2) оверрайды + pending nonce
  const overrides = {
    maxFeePerGas: bump(fee.maxFeePerGas, 60),             // ~60 gwei фолбек
    maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas, 3), // ~3 gwei фолбек
    nonce: await ethers.provider.getTransactionCount(deployer, "pending"),
    // type: 2 // hardhat сам проставит EIP-1559
  } as const;

  // 3) деплой (без аргументов)
  const d = await deploy("MetricsHub", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: 2,
    ...overrides,
  });

  log(`✅ MetricsHub deployed at: ${d.address}`);
};

export default func;
func.id = "deploy_MetricsHub";
func.tags = ["MetricsHub"];
