package app.replay.media3

import android.content.Context
import android.net.Uri
import android.view.SurfaceView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.concurrent.atomic.AtomicBoolean

/** Thin Media3 wrapper used by the Tauri Android plugin. */
class Media3Player(context: Context, private val surface: SurfaceView) {
    private val player: ExoPlayer = ExoPlayer.Builder(context).build().also {
        it.setVideoSurfaceView(surface)
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
        player.seekTo(next.coerceAtLeast(0L))
    }

    fun setVolume(volume: Double) {
        player.volume = (volume / 100.0).toFloat().coerceIn(0f, 1f)
    }

    fun setMuted(muted: Boolean) {
        if (muted) {
            player.volume = 0f
        }
    }

    fun setSpeed(speed: Double) {
        player.setPlaybackSpeed(speed.toFloat().coerceIn(0.25f, 3f))
    }

    fun addListener(listener: Player.Listener) {
        player.addListener(listener)
    }

    fun release() {
        player.release()
    }
}
