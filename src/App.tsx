import { useState, useEffect } from "react";
import { useAccountState, connectAccount, signIn, short, initContracts } from "./utils.ts";
import Home from "./pages/Home.tsx";
import SoloGame from "./pages/SoloGame.tsx";
import MultiplayerLobby from "./pages/MultiplayerLobby.tsx";
import MultiplayerGame from "./pages/MultiplayerGame.tsx";
import Leaderboard from "./pages/Leaderboard.tsx";
import PlayerHistory from "./pages/PlayerHistory.tsx";

// CDM init — fails gracefully if cdm.json doesn't exist yet
try {
    // @ts-ignore — cdm.json is created after `cdm deploy`
    const cdmJson = await import("../cdm.json");
    await initContracts(cdmJson.default ?? cdmJson);
} catch {
    console.warn("[CDM] cdm.json not found — contract features disabled until deploy");
}

type View =
    | { page: "home" }
    | { page: "solo" }
    | { page: "lobby" }
    | { page: "multiplayer"; roomCode: string; isCreator: boolean }
    | { page: "leaderboard" }
    | { page: "history"; playerAddress: string };

export default function App() {
    const { status, account, error } = useAccountState();
    const [view, setView] = useState<View>({ page: "home" });

    useEffect(() => {
        connectAccount();
    }, []);

    if (status === "connecting" || status === "idle") {
        return <div className="spinner">Requesting product account from host...</div>;
    }

    if (status === "signed-out") {
        return (
            <div className="empty">
                <div>Sign in to dotli to play Rock Paper Scissors.</div>
                <button className="btn btn-primary" onClick={() => signIn()} style={{ marginTop: 12 }}>
                    Sign in
                </button>
            </div>
        );
    }

    if (status === "error" || !account) {
        // A missing product account almost always just means the user isn't
        // signed in yet — the host answers with `RequestCredentialsErr::
        // NotConnected`. Show the friendly sign-in prompt for that case; only
        // surface raw error text for genuine failures.
        const notSignedIn =
            !error || /not\s*connected|NotConnected|RequestCredentials/i.test(String(error));
        if (notSignedIn) {
            return (
                <div className="empty">
                    <div>Sign in to dotli to play Rock Paper Scissors.</div>
                    <button className="btn btn-primary" onClick={() => signIn()} style={{ marginTop: 12 }}>
                        Sign in
                    </button>
                </div>
            );
        }
        return (
            <div className="empty">
                <div>Failed to connect: {error}</div>
                <button className="btn btn-primary" onClick={() => connectAccount()} style={{ marginTop: 12 }}>
                    Retry
                </button>
            </div>
        );
    }

    const goHome = () => setView({ page: "home" });

    return (
        <>
            <header>
                <h1 onClick={goHome} style={{ cursor: "pointer" }}>RPS</h1>
                <span className="account-select" title={account.address}>
                    {account.name ?? short(account.address)}
                </span>
            </header>

            {view.page !== "home" && (
                <button className="back-btn" onClick={goHome}>
                    &larr; Back
                </button>
            )}

            {view.page === "home" && (
                <Home
                    account={account}
                    onSolo={() => setView({ page: "solo" })}
                    onMultiplayer={() => setView({ page: "lobby" })}
                    onLeaderboard={() => setView({ page: "leaderboard" })}
                />
            )}

            {view.page === "solo" && <SoloGame account={account} onDone={goHome} />}

            {view.page === "lobby" && (
                <MultiplayerLobby
                    account={account}
                    onGameStart={(roomCode, isCreator) => setView({ page: "multiplayer", roomCode, isCreator })}
                    onBack={goHome}
                />
            )}

            {view.page === "multiplayer" && (
                <MultiplayerGame
                    account={account}
                    roomCode={view.roomCode}
                    isCreator={view.isCreator}
                    onDone={goHome}
                />
            )}

            {view.page === "leaderboard" && (
                <Leaderboard
                    onPlayerClick={addr => setView({ page: "history", playerAddress: addr })}
                />
            )}

            {view.page === "history" && (
                <PlayerHistory
                    playerAddress={view.playerAddress}
                    onBack={() => setView({ page: "leaderboard" })}
                />
            )}
        </>
    );
}
