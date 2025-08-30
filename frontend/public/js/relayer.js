import { initSDK, createInstance, SepoliaConfig } from "https://cdn.zama.ai/relayer-sdk-js/0.1.2/relayer-sdk-js.js";
import { KMS_ADDRESS, RELAYER_URL, GATEWAY_URL } from "./config.js";

export async function initRelayer(provider, contractAddress) {
  await initSDK();
  const cfg = {
    ...SepoliaConfig,
    network: window.ethereum,
    relayerUrl: RELAYER_URL,
    gatewayUrl: GATEWAY_URL,
    debug: true,
  };
  const kmsCode = await provider.getCode(KMS_ADDRESS);
  if (kmsCode === "0x") throw new Error("KMS not found");
  const code = await provider.getCode(contractAddress);
  if (code === "0x") throw new Error("Contract not found");
  const relayer = await createInstance(cfg);
  return relayer;
}

export async function userDecryptHandles(relayer, signer, user, contractAddress, handles) {
  const kp = await relayer.generateKeypair();
  const pairs = handles.map((h) => ({ handle: h, contractAddress }));
  const startTs = Math.floor(Date.now() / 1000).toString();
  const days = "7";
  const eip712 = relayer.createEIP712(kp.publicKey, [contractAddress], startTs, days);
  const sig = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    eip712.message
  );
  const out = await relayer.userDecrypt(
    pairs, kp.privateKey, kp.publicKey, sig.replace("0x",""),
    [contractAddress], await signer.getAddress(), startTs, days
  );
  return out;
}
