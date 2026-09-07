package app.replay.media3

import android.content.Context
import android.net.Uri
import androidx.media3.ui.PlayerView
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import app.tauri.plugin.JSObject
import org.json.JSONArray
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.concurrent.atomic.AtomicBoolean

/** Thin Media3 wrapper used by the Tauri Android plugin. */
@androidx.media3.common.util.UnstableApi
class Media3Player(context: Context, private val surface: PlayerView) {
    private val player: ExoPlayer = ExoPlayer.Builder(context).build().also {
        surface.player = it
    }

    private var requestedVolume = 1f
    private var muted = false

    fun playbackState(): JSObject {
        val phase = when {
            player.playerError != null -> "error"
            player.playbackState == Player.STATE_ENDED -> "ended"
            player.playbackState == Player.STATE_BUFFERING -> "buffering"
            player.playbackState == Player.STATE_IDLE -> "idle"
            player.playWhenReady -> "playing"
            else -> "paused"
        }
        val audio = JSONArray()
        val subtitles = JSONArray()
        player.currentTracks.groups.forEachIndexed { groupIndex, group ->
            val kind = when (group.type) {
                C.TRACK_TYPE_AUDIO -> "audio"
                C.TRACK_TYPE_TEXT -> "subtitle"
                else -> return@forEachIndexed
            }
            for (index in 0 until group.length) {
                if (!group.isTrackSupported(index)) continue
                val format = group.getTrackFormat(index)
                val track = JSObject().apply {
                    put("id", groupIndex * 65536 + index)
                    put("kind", kind)
                    put("title", format.label ?: org.json.JSONObject.NULL)
                    put("language", format.language ?: org.json.JSONObject.NULL)
                    put("codec", format.sampleMimeType ?: org.json.JSONObject.NULL)
                    put("selected", group.isTrackSelected(index))
                    put("external", false)
                }
                if (kind == "audio") audio.put(track) else subtitles.put(track)
            }
        }
        return JSObject().apply {
            put("positionSecs", player.currentPosition.coerceAtLeast(0L) / 1000.0)
            put("durationSecs", player.duration.coerceAtLeast(0L) / 1000.0)
            put("phase", phase)
            put("metadata", JSObject().apply {
                put("title", player.mediaMetadata.title?.toString() ?: org.json.JSONObject.NULL)
                put("width", player.videoSize.width.takeIf { it > 0 } ?: org.json.JSONObject.NULL)
                put("height", player.videoSize.height.takeIf { it > 0 } ?: org.json.JSONObject.NULL)
                put("videoCodec", player.videoFormat?.sampleMimeType ?: org.json.JSONObject.NULL)
                put("audioCodec", player.audioFormat?.sampleMimeType ?: org.json.JSONObject.NULL)
                put("fps", player.videoFormat?.frameRate?.takeIf { it > 0 } ?: org.json.JSONObject.NULL)
            })
            put("audioTracks", audio)
            put("subtitleTracks", subtitles)
            put("error", player.playerError?.message ?: org.json.JSONObject.NULL)
        }
    }

    fun selectTrack(kind: String, trackId: Int?) {
        val type = when (kind) {
            "audio" -> C.TRACK_TYPE_AUDIO
            "subtitle" -> C.TRACK_TYPE_TEXT
            else -> throw IllegalArgumentException("Unsupported track kind.")
        }
        val builder = player.trackSelectionParameters.buildUpon().clearOverridesOfType(type)
            .setTrackTypeDisabled(type, trackId == null)
        if (trackId != null) {
            val group = player.currentTracks.groups.getOrNull(trackId / 65536)
                ?: throw IllegalArgumentException("Track is no longer available.")
            val index = trackId % 65536
            require(group.type == type && index in 0 until group.length && group.isTrackSupported(index))
            builder.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
        }
        player.trackSelectionParameters = builder.build()
    }

    fun load(uri: String, onReady: () -> Unit, onError: (String) -> Unit) {
        val completed = AtomicBoolean(false)
        lateinit var listener: Player.Listener

        fun complete(action: () -> Unit) {
            if (!completed.compareAndSet(false, true)) return
            player.removeListener(listener)
            action()
        }

        listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    complete(onReady)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                complete {
                    onError(error.message ?: "Media3 could not load this media.")
                }
            }
        }

        player.addListener(listener)
        try {
            player.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
            player.prepare()
            player.playWhenReady = true
        } catch (error: Exception) {
            complete {
                onError(error.message ?: "Media3 could not load this media.")
            }
        }
    }

    fun play() {
        player.play()
    }

    fun pause() {
        player.pause()
    }

    fun togglePause() {
        if (player.isPlaying) player.pause() else player.play()
    }

    fun seek(positionMs: Long, absolute: Boolean) {
        val next = if (absolute) positionMs else player.currentPosition + positionMs
        val duration = player.duration
        player.seekTo(if (duration > 0) next.coerceIn(0L, duration) else next.coerceAtLeast(0L))
    }

    fun setVolume(volume: Double) {
        requestedVolume = (volume / 100.0).toFloat().coerceIn(0f, 1f)
        player.volume = if (muted) 0f else requestedVolume
    }

    fun setMuted(muted: Boolean) {
        this.muted = muted
        player.volume = if (muted) 0f else requestedVolume
    }

    fun setSpeed(speed: Double) {
        player.setPlaybackSpeed(speed.toFloat().coerceIn(0.25f, 3f))
    }

    fun addListener(listener: Player.Listener) {
        player.addListener(listener)
    }

    fun release() {
        surface.player = null
        player.release()
    }
}
