import { useMusicStore } from "~/stores/music";
import { useSettingsStore } from "~/stores/settings";
import {
  readFile,
  writeFile,
  exists,
  BaseDirectory,
  remove,
} from "@tauri-apps/plugin-fs";
import type { Song, SongsConfig, Playlist } from "~/types/types";
import Database from "@tauri-apps/plugin-sql";

export default defineNuxtPlugin(async (nuxtApp) => {
  const db = await Database.load("sqlite:data.db");
  const musicStore = useMusicStore();
  const settingsStore = useSettingsStore();

  musicStore.player.audio.addEventListener("error", (e) => {
    if (e.target) {
      const mediaError = e.target.error;
      if (mediaError) {
        console.error("Error with audio element:", mediaError);
        switch (mediaError.code) {
          case mediaError.MEDIA_ERR_ABORTED:
            console.error("You aborted the media playback.");
            break;
          case mediaError.MEDIA_ERR_NETWORK:
            console.error("A network error caused the media download to fail.");
            break;
          case mediaError.MEDIA_ERR_DECODE:
            console.error("The media playback was aborted due to a corruption problem or because the media used features your browser did not support.");
            break;
          case mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            console.error("The media source is not supported. Error code:", mediaError.code);
            break;
          default:
            console.error("An unknown error occurred.");
            break;
        }
      }
    }
  });

  const music = {
    async init() {
      await musicStore.init();
      this.setVolume(settingsStore.getVolume())
    },
    getSongs() {
      return Object.values(musicStore.songsConfig.songs);
    },
    getPlaylists() {
      return Object.values(musicStore.songsConfig.playlists);
    },
    async addSongData(song: Song) {
      musicStore.addSongData(song);
    },
    async updatePlaylistCover(playlistId: string, coverPath: any) {
      if (!coverPath || typeof coverPath !== 'object' || typeof coverPath.path !== 'string') {
        console.error('Invalid coverPath:', coverPath);
        throw new TypeError('coverPath must be an object with a path string');
      }
      const extension = coverPath.path.split('.').pop();
      const newCoverName = `${playlistId}.${extension}`;
      const newCoverPath = `Vleer/Covers/${newCoverName}`;

      const existingExtensions = ['png', 'jpg', 'jpeg', 'gif'];
      for (let ext of existingExtensions) {
        const oldCoverPath = `Vleer/Covers/${playlistId}.${ext}`;
        const coverExists = await exists(oldCoverPath, { baseDir: BaseDirectory.Audio });
        if (coverExists) {
          await remove(oldCoverPath, { baseDir: BaseDirectory.Audio });
        }
      }

      try {
        const data = await readFile(coverPath.path, { baseDir: BaseDirectory.Audio });
        await writeFile(newCoverPath, data, { baseDir: BaseDirectory.Audio });
        await db.execute("UPDATE playlists SET cover = ? WHERE id = ?", [newCoverPath, playlistId]);
      } catch (error) {
        console.error('Failed to update playlist cover:', error);
        throw new Error('Failed to update playlist cover due to path or permission issues.');
      }
    },
    async getCoverURLFromID(playlistId: string): Promise<string> {
      const extensions = ['png', 'jpg', 'jpeg', 'gif'];
      for (let ext of extensions) {
        const coverExists = await exists(`Vleer/Covers/${playlistId}.${ext}`, {
          baseDir: BaseDirectory.Audio,
        });
        if (coverExists) {
          const contents = await readFile(`Vleer/Covers/${playlistId}.${ext}`, {
            baseDir: BaseDirectory.Audio,
          });
          const blob = new Blob([contents]);
          return URL.createObjectURL(blob);
        }
      }
      return "/cover.png";
    },
    async getCoverFromID(songId: string) {
      const contents = await readFile(`Vleer/Covers/${songId}.png`, {
        baseDir: BaseDirectory.Audio,
      });
      return URL.createObjectURL(new Blob([contents]));
    },
    async setSong(id: string) {
      await musicStore.setSong(id);
    },
    play() {
      this.ensureAudioContextAndFilters()
      this.setVolume(settingsStore.getVolume())
      musicStore.play();
    },
    pause() {
      const audio = musicStore.getAudio();
      audio.pause();
    },
    playPause() {
      this.setVolume(settingsStore.getVolume())
      const audio = musicStore.getAudio();
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
    },
    getAudio(): HTMLAudioElement {
      return musicStore.getAudio();
    },
    setVolume(volume: number) {
      const audio = this.getAudio();
      if (volume == 0) {
        audio.volume = 0;
        return;
      }

      const minVolume = 1;
      const maxVolume = 100;
      volume = Math.max(minVolume, Math.min(maxVolume, volume));

      const minp = 0;
      const maxp = 100;

      const minv = Math.log(0.001);
      const maxv = Math.log(1);

      const scale = (maxv - minv) / (maxp - minp);

      audio.volume = Math.exp(minv + scale * (volume - minp));
    },
    getCurrentSong(): Song | null {
      const song = musicStore.getSongByID(musicStore.player.currentSongId);
      if (song) {
        return song;
      }
      return null;
    },
    async applyEqSettings() {
      const eqSettings = settingsStore.getEq();
      await musicStore.applyEqSettings(eqSettings);
    },
    setEqGain(filterIndex: number, gain: number): void {
      musicStore.setEqGain(filterIndex, gain)
    },
    async ensureAudioContextAndFilters() {
      if (!musicStore.player.audioContext) {
        musicStore.player.audioContext = new AudioContext();
        musicStore.player.sourceNode = musicStore.player.audioContext.createMediaElementSource(musicStore.player.audio);
        musicStore.player.analyser = musicStore.player.audioContext.createAnalyser();
        musicStore.player.sourceNode.connect(musicStore.player.analyser);
        musicStore.player.analyser.connect(musicStore.player.audioContext.destination);
        musicStore.player.analyser.fftSize = 256;
        musicStore.player.eqFilters = musicStore.createEqFilters();
        musicStore.connectEqFilters();
        await musicStore.applyEqSettings(musicStore.player.eqFilters);
        if (musicStore.player.audioContext.state === "suspended") {
          await musicStore.player.audioContext.resume();
        }
      } else if (musicStore.player.audioContext.state === "suspended") {
        await musicStore.player.audioContext.resume();
      }
    },
    async setQueue(songIds: string[]) {
      musicStore.setQueue(songIds)
    },
    async skip() {
      musicStore.skip()
    },
    async rewind() {
      musicStore.rewind()
    },
    getSongsData(): SongsConfig {
      return musicStore.getSongsData();
    },
    async createPlaylist(playlist: Playlist) {
      musicStore.createPlaylist(playlist);
    },
    getPlaylistByID(id: string): Playlist {
      return musicStore.getPlaylistByID(id);
    },
    getSongByID(id: string): Song {
      return musicStore.getSongByID(id);
    },
    addSongToPlaylist(playlistId: string, songId: string) {
      musicStore.addSongToPlaylist(playlistId, songId);
    },
    renamePlaylist(playlistId: string, newName: string) {
      musicStore.renamePlaylist(playlistId, newName);
    },
    getLastUpdated() {
      return musicStore.getLastUpdated();
    },
    async searchCoverByPlaylistId(playlistId: string): Promise<string> {
      const extensions = ['png', 'jpg', 'jpeg', 'gif'];
      for (let ext of extensions) {
        const coverExists = await exists(`Vleer/Covers/${playlistId}.${ext}`, {
          baseDir: BaseDirectory.Audio,
        });
        if (coverExists) {
          const contents = await readFile(`Vleer/Covers/${playlistId}.${ext}`, {
            baseDir: BaseDirectory.Audio,
          });
          const blob = new Blob([contents]);
          return URL.createObjectURL(blob);
        }
      }
      return "/cover.png";
    },
    getAudioContext() {
      return musicStore.player.audioContext;
    },
    getAnalyser() {
      return musicStore.player.analyser;
    },
    setAnalyser(analyser: AnalyserNode) {
      musicStore.player.analyser = analyser;
    },
  };

  musicStore.player.audio.addEventListener('ended', () => {
    music.skip();
  });

  return {
    provide: {
      music,
    },
  };
});
