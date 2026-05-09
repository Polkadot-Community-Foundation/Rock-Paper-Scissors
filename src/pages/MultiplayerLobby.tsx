import { useState, useEffect, useRef } from "react";
import type { AppAccount } from "../utils.ts";
import { StatementStoreClient } from "@parity/product-sdk-statement-store";
import { generateRoomCode } from "../utils.ts";

interface JoinMessage {
    type: "join";
    peerId: string;
    timestamp: number;
}

export default function MultiplayerLobby({ account, onGameStart }: {
    account: AppAccount;
    onGameStart: (roomCode: string, isCreator: boolean) => void;
    onBack: () => void;
}) {
    const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
    const [roomCode, setRoomCode] = useState("");
    const [joinCode, setJoinCode] = useState("");
    const [waiting, setWaiting] = useState(false);
    const [statusMsg, setStatusMsg] = useState("");
    const clientRef = useRef<StatementStoreClient | null>(null);

    useEffect(() => {
        return () => { clientRef.current?.destroy(); };
    }, []);

    const createRoom = async () => {
        const code = generateRoomCode();
        setRoomCode(code);
        setMode("create");
        setWaiting(true);
        setStatusMsg("Creating room...");

        try {
            const client = new StatementStoreClient({
                appName: "rps-game",
                defaultTtlSeconds: 600,
            });
            clientRef.current = client;

            await client.connect({
                mode: "host",
                accountId: account.productAccountId,
            });

            client.subscribe<JoinMessage>((statement) => {
                const msg = statement.data;
                if (msg.type === "join" && msg.peerId !== account.h160Address) {
                    setStatusMsg("Opponent found! Starting game...");
                    setTimeout(() => {
                        client.destroy();
                        clientRef.current = null;
                        onGameStart(code, true);
                    }, 500);
                }
            }, { topic2: code });

            await client.publish<JoinMessage>(
                { type: "join", peerId: account.h160Address, timestamp: Date.now() },
                { channel: `${code}/presence/${account.h160Address}`, topic2: code },
            );

            setStatusMsg("Waiting for opponent...");
        } catch (err) {
            console.error("[Lobby] Error:", err);
            setStatusMsg("Failed: " + (err instanceof Error ? err.message : String(err)));
            setWaiting(false);
        }
    };

    const joinRoom = async () => {
        const code = joinCode.trim().toUpperCase();
        if (code.length < 4) return;

        setRoomCode(code);
        setWaiting(true);
        setStatusMsg("Joining room...");

        try {
            const client = new StatementStoreClient({
                appName: "rps-game",
                defaultTtlSeconds: 600,
            });
            clientRef.current = client;

            await client.connect({
                mode: "host",
                accountId: account.productAccountId,
            });

            await client.publish<JoinMessage>(
                { type: "join", peerId: account.h160Address, timestamp: Date.now() },
                { channel: `${code}/presence/${account.h160Address}`, topic2: code },
            );

            setStatusMsg("Joined! Starting game...");
            setTimeout(() => {
                client.destroy();
                clientRef.current = null;
                onGameStart(code, false);
            }, 500);
        } catch (err) {
            console.error("[Lobby] Error:", err);
            setStatusMsg("Failed: " + (err instanceof Error ? err.message : String(err)));
            setWaiting(false);
        }
    };

    if (mode === "choose") {
        return (
            <div className="lobby">
                <h2>Multiplayer</h2>
                <div className="lobby-options">
                    <div className="mode-card" onClick={createRoom}>
                        <div className="mode-card-title">Create Room</div>
                        <div className="mode-card-desc">Get a code and share it with your opponent</div>
                    </div>
                    <div className="mode-card" onClick={() => setMode("join")}>
                        <div className="mode-card-title">Join Room</div>
                        <div className="mode-card-desc">Enter a code to join an existing room</div>
                    </div>
                </div>
            </div>
        );
    }

    if (mode === "create") {
        return (
            <div className="lobby">
                <h2>Your Room</h2>
                <div className="room-code-display">
                    <div className="code">{roomCode}</div>
                    <div className="label">Share this code with your opponent</div>
                </div>
                {statusMsg && <div className="status">{statusMsg}</div>}
                {waiting && <div className="waiting-opponent">Waiting for opponent to join...</div>}
            </div>
        );
    }

    return (
        <div className="lobby">
            <h2>Join Room</h2>
            <div className="room-input">
                <input
                    type="text"
                    placeholder="ROOM CODE"
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                    maxLength={6}
                    disabled={waiting}
                />
                <button
                    className="btn btn-primary"
                    onClick={joinRoom}
                    disabled={joinCode.trim().length < 4 || waiting}
                >
                    {waiting ? "Joining..." : "Join"}
                </button>
            </div>
            {statusMsg && <div className="status">{statusMsg}</div>}
        </div>
    );
}
