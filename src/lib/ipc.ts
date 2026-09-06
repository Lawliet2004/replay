import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PlayerCommand, PlayerEvent, PlayerSnapshot, Settings } from "../generated/player";

export async function sendCommand(command: PlayerCommand): Promise<void> {
  return invoke<void>("player_command", { command });
}

export async function getSnapshot(): Promise<PlayerSnapshot> {
  return invoke<PlayerSnapshot>("get_snapshot");
}

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function updateSettings(settings: Settings): Promise<Settings> {
  return invoke<Settings>("update_settings", { settings });
}

export function listenPlayerEvents(handler: (event: PlayerEvent) => void): Promise<UnlistenFn> {
  return listen<PlayerEvent>("player://event", (e) => handler(e.payload));
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
