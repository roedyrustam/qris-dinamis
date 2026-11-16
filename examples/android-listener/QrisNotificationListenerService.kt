package com.qrisdinamis.listener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Android NotificationListenerService that forwards Indonesian bank & e-wallet
 * QRIS payment notifications to a self-hosted @qris-dinamis/api instance.
 */
class QrisNotificationListenerService : NotificationListenerService() {

    private val executor = Executors.newSingleThreadExecutor()

    private val packageSourceMap = mapOf(
        "com.bca" to "bca",
        "com.bca.mybca.omni.android" to "mybca",
        "id.co.bri.brimo" to "brimo",
        "id.bmri.livin" to "livin",
        "id.co.bni.wondr" to "wondr",
        "src.com.bni" to "bni-mobile",
        "com.gojek.gobiz" to "gobiz",
        "ovo.id" to "ovo",
        "id.dana" to "dana",
        "com.shopee.id" to "shopeepay",
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val source = packageSourceMap[sbn.packageName] ?: return
        val extras = sbn.notification.extras
        val title = extras.getString(Notification.EXTRA_TITLE).orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()

        val combined = listOf(title, bigText.ifBlank { text }).filter { it.isNotBlank() }.joinToString(" - ")
        if (combined.isBlank()) return

        executor.execute {
            postNotification(source = source, text = combined)
        }
    }

    private fun postNotification(source: String, text: String) {
        val apiBaseUrl = "https://your-qris-api.example.com"
        val merchantId = "merch_replace_me"
        val apiKey = "qris_live_replace_me"

        val url = URL("$apiBaseUrl/v1/ingest/notification")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 8000
            readTimeout = 8000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-Api-Key", apiKey)
        }

        val payload = JSONObject().apply {
            put("merchantId", merchantId)
            put("source", source)
            put("text", text)
        }

        try {
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
            }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }
}
