import { useState, useEffect } from "react";
import { getContract, short, asBytes20 } from "../utils.ts";
import type { LeaderboardEntry } from "../types.ts";

export default function Leaderboard({ onPlayerClick }: {
    onPlayerClick: (address: string) => void;
}) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const lb = getContract();
                if (!lb) { setLoading(false); return; }

                const countRes = await lb.getPlayerCount.query();
                if (!countRes.success || cancelled) return;
                const count = Number(countRes.value);

                const items: LeaderboardEntry[] = [];
                for (let i = 0; i < count; i++) {
                    if (cancelled) return;
                    const addrRes = await lb.getPlayerAt.query(BigInt(i));

                    if (!addrRes.success) continue;
                    // sdk-ink v0.7 returns bytes20 as either a hex string ("0x..."),
                    // a Uint8Array, or a Binary instance with .asHex() — handle all.
                    const v = addrRes.value as unknown;
                    let address: `0x${string}`;
                    if (typeof v === "string" && v.startsWith("0x")) {
                        address = v as `0x${string}`;
                    } else if (v instanceof Uint8Array) {
                        address = ("0x" + [...v].map(b => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
                    } else if (v && typeof (v as any).asHex === "function") {
                        address = (v as any).asHex() as `0x${string}`;
                    } else {
                        console.warn("[Leaderboard] unrecognized address shape:", v);
                        continue;
                    }

                    const pRes = await lb.getPlayerPoints.query(asBytes20(address));
                    const points = pRes.success ? Number(pRes.value) : 0;

                    items.push({ address, points, rank: 0 });
                }

                items.sort((a, b) => b.points - a.points);
                items.forEach((item, i) => { item.rank = i + 1; });

                if (!cancelled) setEntries(items);
            } catch (err) {
                console.error("Failed to load leaderboard:", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (loading) return <div className="spinner">Loading leaderboard...</div>;

    const lb = getContract();
    if (!lb) return <div className="empty">Contract not deployed yet.<br />Run `cdm deploy && cdm install`.</div>;
    if (entries.length === 0) return <div className="empty">No players yet.<br />Play a game to get on the board!</div>;

    return (
        <div className="leaderboard">
            <h2>Leaderboard</h2>
            <div className="lb-table">
                {entries.map(e => (
                    <div
                        key={e.address}
                        className="lb-row"
                        onClick={() => onPlayerClick(e.address)}
                    >
                        <div className={`lb-rank ${e.rank === 1 ? "gold" : e.rank === 2 ? "silver" : e.rank === 3 ? "bronze" : ""}`}>
                            #{e.rank}
                        </div>
                        <div className="lb-address">{short(e.address)}</div>
                        <div className={`lb-points ${e.points > 0 ? "positive" : e.points < 0 ? "negative" : ""}`}>
                            {e.points > 0 ? `+${e.points}` : e.points} pts
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
