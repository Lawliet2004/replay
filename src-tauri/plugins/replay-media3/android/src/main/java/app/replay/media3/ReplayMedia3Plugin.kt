package app.replay.media3

import android.app.Activity
import android.graphics.Color
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class UriArgs {
    lateinit var uri: String
}

@InvokeArg
class SeekArgs {
    var positionMs: Long = 0
    var absolute: Boolean = true
}

@InvokeArg
class VolumeArgs {
    var volume: Double = 100.0
}

@InvokeArg
class MutedArgs {
    var muted: Boolean = false
}

@InvokeArg
class SpeedArgs {
    var speed: Double = 1.0
}

@InvokeArg
class VisibleArgs {
    var visible: Boolean = false
}

@InvokeArg
class SurfaceArgs {
    var x: Int = 0
    var y: Int = 0
    var w: Int = 0
    var h: Int = 0
}

@TauriPlugin
class ReplayMedia3Plugin(private val activity: Activity) : Plugin(activity) {
    private var player: Media3Player? = null
    private var surface: SurfaceView? = null
    private var surfaceVisible: Boolean = false

    override fun load(webView: WebView) {
        activity.runOnUiThread {
            webView.setBackgroundColor(Color.TRANSPARENT)
            val parent = webView.parent as? ViewGroup ?: return@runOnUiThread
            val sv = SurfaceView(activity)
            sv.visibility = if (surfaceVisible) View.VISIBLE else View.GONE
            val params = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            parent.addView(sv, 0, params)
            surface = sv
            player = Media3Player(activity, sv)
        }
    }

    @Command
    fun load(invoke: Invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        activity.runOnUiThread {
            val mediaPlayer = player
            if (mediaPlayer == null) {
                invoke.reject("Media3 is not initialized.")
                return@runOnUiThread
            }
            mediaPlayer.load(
                args.uri,
                onReady = { invoke.resolve() },
                onError = { message -> invoke.reject(message) },
            )
        }
    }

    @Command
    fun play(invoke: Invoke) {
        activity.runOnUiThread {
            player?.play()
            invoke.resolve()
        }
    }

    @Command
    fun pause(invoke: Invoke) {
        activity.runOnUiThread {
            player?.pause()
            invoke.resolve()
        }
    }

    @Command
    fun togglePause(invoke: Invoke) {
        activity.runOnUiThread {
            player?.togglePause()
            invoke.resolve()
        }
    }

    @Command
    fun seek(invoke: Invoke) {
        val args = invoke.parseArgs(SeekArgs::class.java)
        activity.runOnUiThread {
            player?.seek(args.positionMs, args.absolute)
            invoke.resolve()
        }
    }

    @Command
    fun setVolume(invoke: Invoke) {
        val args = invoke.parseArgs(VolumeArgs::class.java)
        activity.runOnUiThread {
            player?.setVolume(args.volume)
            invoke.resolve()
        }
    }

    @Command
    fun setMuted(invoke: Invoke) {
        val args = invoke.parseArgs(MutedArgs::class.java)
        activity.runOnUiThread {
            player?.setMuted(args.muted)
            invoke.resolve()
        }
    }

    @Command
    fun setSpeed(invoke: Invoke) {
        val args = invoke.parseArgs(SpeedArgs::class.java)
        activity.runOnUiThread {
            player?.setSpeed(args.speed)
            invoke.resolve()
        }
    }

    @Command
    fun selectTrack(invoke: Invoke) {
        invoke.resolve()
    }

    @Command
    fun addSubtitle(invoke: Invoke) {
        invoke.resolve()
    }

    @Command
    fun setSurface(invoke: Invoke) {
        val args = invoke.parseArgs(SurfaceArgs::class.java)
        activity.runOnUiThread {
            surface?.let { sv ->
                val params = (sv.layoutParams as? FrameLayout.LayoutParams)
                    ?: FrameLayout.LayoutParams(args.w, args.h)
                params.width = args.w
                params.height = args.h
                params.leftMargin = args.x
                params.topMargin = args.y
                sv.layoutParams = params
                sv.requestLayout()
            }
            invoke.resolve()
        }
    }

    @Command
    fun setVisible(invoke: Invoke) {
        val args = invoke.parseArgs(VisibleArgs::class.java)
        activity.runOnUiThread {
            surfaceVisible = args.visible
            surface?.visibility = if (surfaceVisible) View.VISIBLE else View.GONE
            invoke.resolve()
        }
    }
}
