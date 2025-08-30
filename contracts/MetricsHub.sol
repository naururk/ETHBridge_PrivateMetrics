// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, euint128, ebool, externalEuint128 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title MetricsHub
 * @notice FHE-метрики + per-user история. originTxHash (хэш депозита/вывода) — в ивенте.
 */
contract MetricsHub is SepoliaConfig {
    struct Pair {
        euint128 totalVolumeWei;
        euint64  txCount;
        euint128 publicVolumeWei;
        euint64  publicCount;
        bool     inited;
    }

    // key = (uint32(src) << 32) | uint32(dst)
    mapping(uint64 => Pair) private _pairs;

    // per-user history (amounts + timestamps)
    mapping(uint64 => mapping(address => euint128[])) private _histAmts;
    mapping(uint64 => mapping(address => uint64[]))   private _histTs;

    // originTx — в ивенте
    event Recorded(uint32 indexed src, uint32 indexed dst, address indexed user, uint256 idx, bytes32 originTx);
    event PublicReady(uint32 indexed src, uint32 indexed dst);

    function _key(uint32 src, uint32 dst) internal pure returns (uint64) {
        return (uint64(src) << 32) | uint64(dst);
    }

    function record(
        uint32 srcChainId,
        uint32 dstChainId,
        externalEuint128 amountWeiExt,
        bytes calldata inputProof,
        bytes32 originTxHash
    ) external {
        uint64 k = _key(srcChainId, dstChainId);

        if (!_pairs[k].inited) {
            _pairs[k].totalVolumeWei  = FHE.asEuint128(0);
            _pairs[k].txCount         = FHE.asEuint64(0);
            _pairs[k].publicVolumeWei = FHE.asEuint128(0);
            _pairs[k].publicCount     = FHE.asEuint64(0);
            _pairs[k].inited          = true;

            // агрегаты должны быть реюзабельны между транзами
            FHE.allowThis(_pairs[k].totalVolumeWei);
            FHE.allowThis(_pairs[k].txCount);
            FHE.allowThis(_pairs[k].publicVolumeWei);
            FHE.allowThis(_pairs[k].publicCount);
        }

        // импорт и апдейт агрегатов
        euint128 amountWei = FHE.fromExternal(amountWeiExt, inputProof);

        _pairs[k].totalVolumeWei = FHE.add(_pairs[k].totalVolumeWei, amountWei);
        _pairs[k].txCount        = FHE.add(_pairs[k].txCount,        FHE.asEuint64(1));

        FHE.allowThis(_pairs[k].totalVolumeWei);
        FHE.allowThis(_pairs[k].txCount);

        // ── история ──
        _histAmts[k][msg.sender].push(amountWei);
        _histTs[k][msg.sender].push(uint64(block.timestamp));
        uint256 idx = _histAmts[k][msg.sender].length - 1;

        // ① Делаем сам элемент истории реюзабельным контрактом в будущих транзах
        FHE.allowThis(_histAmts[k][msg.sender][idx]);

        // ② И сразу даём право на расшифровку владельцу записи
        FHE.allow(_histAmts[k][msg.sender][idx], msg.sender);

        // (опционально) приватный доступ к агрегатам
        FHE.allow(_pairs[k].totalVolumeWei, msg.sender);
        FHE.allow(_pairs[k].txCount,        msg.sender);

        emit Recorded(srcChainId, dstChainId, msg.sender, idx, originTxHash);
    }

    function publish(uint32 srcChainId, uint32 dstChainId, uint64 kThreshold) external {
        uint64 k = _key(srcChainId, dstChainId);
        require(_pairs[k].inited, "pair not initialized");

        ebool   canReveal = FHE.ge(_pairs[k].txCount, FHE.asEuint64(kThreshold));
        euint128 dVol     = FHE.sub(_pairs[k].totalVolumeWei, _pairs[k].publicVolumeWei);
        euint64  dCnt     = FHE.sub(_pairs[k].txCount,        _pairs[k].publicCount);

        _pairs[k].publicVolumeWei = FHE.add(
            _pairs[k].publicVolumeWei,
            FHE.select(canReveal, dVol, FHE.asEuint128(0))
        );
        _pairs[k].publicCount = FHE.add(
            _pairs[k].publicCount,
            FHE.select(canReveal, dCnt, FHE.asEuint64(0))
        );

        FHE.makePubliclyDecryptable(_pairs[k].publicVolumeWei);
        FHE.makePubliclyDecryptable(_pairs[k].publicCount);

        FHE.allowThis(_pairs[k].publicVolumeWei);
        FHE.allowThis(_pairs[k].publicCount);

        emit PublicReady(srcChainId, dstChainId);
    }

    /* ───── Views (handles только; без FHE-операций) ───── */

    function getTotals(uint32 srcChainId, uint32 dstChainId)
        external view returns (euint128, euint64)
    {
        Pair storage p = _pairs[_key(srcChainId, dstChainId)];
        return (p.totalVolumeWei, p.txCount);
    }

    function getPublicSnapshots(uint32 srcChainId, uint32 dstChainId)
        external view returns (euint128, euint64)
    {
        Pair storage p = _pairs[_key(srcChainId, dstChainId)];
        return (p.publicVolumeWei, p.publicCount);
    }

    function myHistoryLength(uint32 srcChainId, uint32 dstChainId)
        external view returns (uint256)
    {
        return _histAmts[_key(srcChainId, dstChainId)][msg.sender].length;
    }

    function getMyHistory(
        uint32 srcChainId,
        uint32 dstChainId,
        uint256 start,
        uint256 count
    ) external view returns (euint128[] memory amounts, uint64[] memory timestamps)
    {
        uint64 k = _key(srcChainId, dstChainId);
        euint128[] storage A = _histAmts[k][msg.sender];
        uint64[]   storage T = _histTs[k][msg.sender];

        uint256 n = A.length;
        if (start > n) start = n;
        if (count > 200) count = 200;
        uint256 end = start + count;
        if (end > n) end = n;
        uint256 m = end > start ? end - start : 0;

        amounts    = new euint128[](m);
        timestamps = new uint64[](m);
        for (uint256 i = 0; i < m; i++) {
            amounts[i]    = A[start + i];
            timestamps[i] = T[start + i];
        }
    }

    /* ───── Utilities: массовая выдача прав на уже сохранённые записи ───── */

    /// Выдать себе право на диапазон [start, end) и сделать элементы реюзабельными контрактом.
    function grantMyHistoryRange(
        uint32 srcChainId,
        uint32 dstChainId,
        uint256 start,
        uint256 endExclusive
    ) external {
        uint64 k = _key(srcChainId, dstChainId);
        euint128[] storage A = _histAmts[k][msg.sender];
        uint256 n = A.length;
        if (endExclusive > n) endExclusive = n;
        require(start < endExclusive, "empty");

        for (uint256 j = start; j < endExclusive; j++) {
            // ③ Если когда-то забыли allowThis при сохранении — добавим его ретроактивно
            FHE.allowThis(A[j]);
            FHE.allow(A[j], msg.sender);
        }
    }

    function grantMyHistory(
        uint32 srcChainId,
        uint32 dstChainId,
        uint256[] calldata idxs
    ) external {
        uint64 k = _key(srcChainId, dstChainId);
        euint128[] storage A = _histAmts[k][msg.sender];
        uint256 n = A.length;
        for (uint256 i = 0; i < idxs.length; i++) {
            uint256 j = idxs[i];
            require(j < n, "bad index");
            FHE.allowThis(A[j]);
            FHE.allow(A[j], msg.sender);
        }
    }

    function version() external pure returns (string memory) {
        return "metrics-hub/1.3.1-history-allowthis";
    }
}
