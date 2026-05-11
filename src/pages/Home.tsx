import type { AppAccount } from "../utils.ts";
import MyProfile from "./MyProfile.tsx";

export default function Home({ account, onSolo, onMultiplayer, onLeaderboard }: {
    account: AppAccount | null;
    onSolo: () => void;
    onMultiplayer: () => void;
    onLeaderboard: () => void;
}) {
    return (
        <div>
            {account && <MyProfile account={account} />}

            <div className="home">
                <div className="home-title">Rock Paper Scissors</div>
                <div className="home-subtitle">Decentralized on Polkadot</div>

                <div className="home-modes">
                    <div className="mode-card" onClick={onSolo}>
                        <div className="mode-card-title">Solo</div>
                        <div className="mode-card-desc">Play against the computer</div>
                    </div>
                    <div className="mode-card" onClick={onMultiplayer}>
                        <div className="mode-card-title">Multiplayer</div>
                        <div className="mode-card-desc">Play against another player via Statement Store</div>
                    </div>
                </div>

                <div className="home-links">
                    <button className="btn btn-ghost" onClick={onLeaderboard}>
                        Leaderboard
                    </button>
                </div>
            </div>
        </div>
    );
}
