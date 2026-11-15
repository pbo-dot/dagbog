package dk.dagbog.billeder

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.ExifInterface
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Prøve: kan en rigtig app læse dato og sted fra billederne på telefonen, og kan den give det
 * videre til Dagbog? Intet gemmes, og ingen billeder sendes. Resultatet er en tekst, der kan
 * kopieres eller sendes til Dagbog. Bygget i kode, ingen XML-layouts.
 */
/** Billedernes størrelse på den lange led (Dagbog henter alle igen, når den ændres). */
private const val THUMB_PX = 1080

/** Svar fra filvælgeren til Google Takeout. */
private const val TAKEOUT = 7

class MainActivity : Activity() {
    private lateinit var out: TextView
    private val report = StringBuilder()
    private var busy = false

    /** Lov til at se billederne: Android 13+ har sin egen tilladelse, ældre telefoner bruger lager-tilladelsen. */
    private val readPerm = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE

    private val wanted = listOfNotNull(
        readPerm,
        if (Build.VERSION.SDK_INT >= 34) Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED else null,
        Manifest.permission.ACCESS_MEDIA_LOCATION,
    ).toTypedArray()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dark = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val bg = if (dark) 0xFF171513.toInt() else 0xFFF7F3EC.toInt()
        val text = if (dark) 0xFFF1ECE4.toInt() else 0xFF1F1C19.toInt()
        val surface = if (dark) 0xFF24211E.toInt() else 0xFFFFFDF9.toInt()
        val accent = if (dark) 0xFF8CC3AE.toInt() else 0xFF2F6B57.toInt()
        val onAccent = if (dark) 0xFF10231C.toInt() else Color.WHITE
        val tonal = if (dark) 0xFF34302B.toInt() else 0xFFEFE9DF.toInt()
        window.statusBarColor = bg
        window.navigationBarColor = bg

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        col.addView(TextView(this).apply {
            this.text = "Dagbog Billeder"
            textSize = 28f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
            setTextColor(text)
        })
        col.addView(TextView(this).apply {
            this.text = "Læser dato og sted fra kamera-billederne og sender dem til Dagbog. Selve billederne bliver på telefonen."
            textSize = 16f
            setTextColor(text)
            setPadding(0, dp(6), 0, dp(18))
        })
        col.addView(button("Send billederne til Dagbog", accent, onAccent) { driveMode = false; start(send = true) })
        col.addView(button("Gem på Drev (til en anden telefon)", tonal, text) { driveMode = true; start(send = true) })
        col.addView(button("Prøve: læs uden at sende", tonal, text) { start(send = false) })
        col.addView(button("Læs Google Takeout (zip) · prøve", tonal, text) { pickTakeout() })
        col.addView(button("Kopiér loggen", tonal, text) { copy() })
        col.addView(button("Del loggen med Claude", tonal, text) { shareLog() })
        out = TextView(this).apply {
            textSize = 13f
            typeface = Typeface.MONOSPACE
            setTextColor(text)
            setTextIsSelectable(true)
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = GradientDrawable().apply { setColor(surface); cornerRadius = dp(20).toFloat() }
        }
        col.addView(out, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(12) })
        setContentView(ScrollView(this).apply {
            setBackgroundColor(bg)
            addView(col)
        })
        say("Tryk \"Send billederne til Dagbog\", og vælg \"Tillad alle\", når telefonen spørger.")
        if (intent?.data?.scheme == "dagbogbilleder") fromDagbog(intent)
    }

    /** Dagbog fortæller med "?fra=ÅÅÅÅ-MM-DD", fra hvilken dag den mangler små billeder. */
    private var fromDay: String? = null

    private fun fromDagbog(i: Intent) {
        fromDay = i.data?.getQueryParameter("fra")
        driveMode = false
        start(send = true)
    }

    // Åbnet igen fra Dagbog, mens appen stadig kører
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.data?.scheme == "dagbogbilleder") fromDagbog(intent)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun button(label: String, color: Int, textColor: Int, onClick: () -> Unit): View =
        TextView(this).apply {
            text = label
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(textColor)
            minHeight = dp(56)
            background = GradientDrawable().apply { setColor(color); cornerRadius = dp(28).toFloat() }
            isClickable = true
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(10) }
        }

    private fun say(line: String) {
        report.append(line).append('\n')
        runOnUiThread { out.text = report }
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private var sendAfter = false

    /** "Gem på Drev": billederne fra denne (gamle) telefon gemmes i filer, som Dagbog på den nye telefon læser. */
    private var driveMode = false

    /** Lægges til billedernes nummer, når de gemmes på Drev, så de ikke blandes med den nye telefons. */
    private var idBase = 0L

    private fun start(send: Boolean) {
        if (!send) driveMode = false
        if (!driveMode) idBase = 0L
        if (busy) return
        sendAfter = send
        if (!granted(readPerm) || !granted(Manifest.permission.ACCESS_MEDIA_LOCATION)) {
            requestPermissions(wanted, 1)
            return
        }
        scan()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        scan()
    }

    /** Tæller billederne og læser dato og sted for et jævnt fordelt udvalg. */
    private fun scan() {
        if (busy) return
        busy = true
        report.setLength(0)
        say("Dagbog Billeder prøve · ${SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).format(Date())}")
        say("${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        say("Tilladelser: billeder ${ja(granted(readPerm))} · sted ${ja(granted(Manifest.permission.ACCESS_MEDIA_LOCATION))}")
        thread {
            try {
                if (driveMode) {
                    driveRound()
                    busy = false
                    return@thread
                }
                val lines = read(everyPhoto = sendAfter)
                if (sendAfter && lines != null) {
                    val file = writeFile(lines)
                    runOnUiThread { sendToDagbog(file) }
                }
            } catch (e: Throwable) {
                // Også "for lidt hukommelse" (OutOfMemoryError), som ellers stopper uden besked
                say("FEJL: ${e.javaClass.simpleName}: ${e.message}")
            }
            busy = false
        }
    }

    private fun ja(b: Boolean) = if (b) "JA" else "NEJ"

    private data class Pic(val id: Long, val name: String, val taken: Long, val path: String, val size: Long)

    /** Læser billederne. Med `everyPhoto` læses sted for alle kamera-billeder, og listen til Dagbog returneres. */
    private fun read(everyPhoto: Boolean): List<String>? {
        val base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val cols = arrayOf(
            MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.RELATIVE_PATH, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_MODIFIED,
        )
        val t0 = SystemClock.elapsedRealtime()
        val all = ArrayList<Pic>()
        contentResolver.query(base, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val taken = if (c.isNull(2) || c.getLong(2) == 0L) c.getLong(5) * 1000 else c.getLong(2)
                all.add(Pic(c.getLong(0), c.getString(1) ?: "", taken, c.getString(3) ?: "", c.getLong(4)))
            }
        }
        say("Billeder i alt: ${all.size} (fundet på ${SystemClock.elapsedRealtime() - t0} ms)")
        val folders = all.groupingBy { it.path }.eachCount().entries.sortedByDescending { it.value }.take(6)
        say("Mapper: " + folders.joinToString(" · ") { "${it.key} ${it.value}" })
        val camera = all.filter { it.path.startsWith("DCIM/") }.sortedBy { it.taken }
        if (camera.isEmpty()) {
            say("Ingen billeder i DCIM. Har appen fået lov til alle billeder?")
            return null
        }
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT)
        say("Kamera-billeder: ${camera.size} · fra ${day.format(Date(camera.first().taken))} til ${day.format(Date(camera.last().taken))}")
        val days = camera.groupingBy { day.format(Date(it.taken)) }.eachCount()
        say("Dage med billeder: ${days.size} · flest på én dag: ${days.values.max()} · dage med over 3: ${days.values.count { it > 3 }}")

        if (everyPhoto) return readAll(camera, base) + thumbs(camera, base)

        // Sted og dato for et udvalg (jævnt fordelt), og hvor længe det tager
        val n = minOf(60, camera.size)
        val sample = List(n) { camera[if (n == 1) 0 else it * (camera.size - 1) / (n - 1)] }
        var withPlace = 0
        var failed = 0
        val shown = ArrayList<String>()
        val t1 = SystemClock.elapsedRealtime()
        val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT)
        for ((i, p) in sample.withIndex()) {
            var place = "MANGLER"
            try {
                val uri = MediaStore.setRequireOriginal(ContentUris.withAppendedId(base, p.id))
                contentResolver.openInputStream(uri)?.use { s ->
                    val ll = FloatArray(2)
                    if (ExifInterface(s).getLatLong(ll)) {
                        withPlace++
                        place = String.format(Locale.ROOT, "%.1f, %.1f", ll[0], ll[1])
                    }
                }
            } catch (e: Exception) {
                failed++
                place = "FEJL ${e.javaClass.simpleName}: ${e.message}"
            }
            if (i % maxOf(1, n / 5) == 0 && shown.size < 5) {
                shown.add("${p.name} · ${p.size / 1024} kB · taget ${stamp.format(Date(p.taken))} · sted $place")
            }
        }
        val ms = SystemClock.elapsedRealtime() - t1
        say("Undersøgt: $n på $ms ms (${ms / maxOf(1, n)} ms pr. billede) · med sted: $withPlace · fejl: $failed")
        shown.forEach { say(it) }
        say("Alle ${camera.size} ville tage ca. ${camera.size * ms / maxOf(1, n) / 1000} s")
        return null
    }

    /** Sted for alle kamera-billeder: én linje pr. billede, "id;taget-ms;bredde;længde". */
    private fun readAll(camera: List<Pic>, base: android.net.Uri): List<String> {
        val t0 = SystemClock.elapsedRealtime()
        val out = ArrayList<String>(camera.size)
        var withPlace = 0
        var failed = 0
        for ((i, p) in camera.withIndex()) {
            var place = ";"
            try {
                val uri = MediaStore.setRequireOriginal(ContentUris.withAppendedId(base, p.id))
                contentResolver.openInputStream(uri)?.use { s ->
                    val ll = FloatArray(2)
                    if (ExifInterface(s).getLatLong(ll)) {
                        withPlace++
                        place = String.format(Locale.ROOT, "%.5f;%.5f", ll[0], ll[1])
                    }
                }
            } catch (e: Exception) {
                failed++
                if (failed <= 3) say("Fejl ved ${p.name}: ${e.javaClass.simpleName}: ${e.message}")
            }
            out.add("${p.id + idBase};${p.taken};$place")
            if (i % 100 == 99) say("… ${i + 1} af ${camera.size}")
        }
        say("Læst: ${camera.size} på ${(SystemClock.elapsedRealtime() - t0) / 1000} s · med sted: $withPlace · fejl: $failed")
        return out
    }

    /** Vælg en eller flere Takeout-zip-filer (også direkte fra Drev). */
    private fun pickTakeout() {
        if (busy) return
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream"))
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(i, TAKEOUT)
        } catch (e: Exception) {
            say("Kunne ikke åbne filvælgeren: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    @Deprecated("Activity-API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != TAKEOUT || resultCode != RESULT_OK || data == null) return
        val uris = ArrayList<android.net.Uri>()
        data.clipData?.let { c -> for (k in 0 until c.itemCount) uris.add(c.getItemAt(k).uri) }
        if (uris.isEmpty()) data.data?.let { uris.add(it) }
        if (uris.isEmpty() || busy) return
        busy = true
        report.setLength(0)
        say("Dagbog Billeder ${appVersion()} · Takeout-prøve · ${SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).format(Date())}")
        say("${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        say("Valgte filer: ${uris.size}")
        thread {
            val t = Takeout(contentResolver) { say(it) }
            for (u in uris) {
                try {
                    t.probe(u)
                } catch (e: Throwable) {
                    say("FEJL: ${e.javaClass.simpleName}: ${e.message}")
                }
            }
            say("")
            say("Færdig. Tryk \"Del loggen med Claude\", og gem filen på Drev.")
            busy = false
        }
    }

    /** Loggen som én fil, der kan gemmes på Drev, så Claude kan læse den. */
    private fun shareLog() {
        try {
            val name = "dagbog-billeder-log-${SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.ROOT).format(Date())}.txt"
            val f = File(ShareProvider.dir(this), name)
            f.writeText(report.toString())
            val uri = ShareProvider.uri(f.name)
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, name)
            send.clipData = ClipData.newRawUri(f.name, uri)
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(Intent.createChooser(send, "Del loggen").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (e: Exception) {
            say("FEJL ved deling: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun appVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }

    private fun copy() {
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Dagbog Billeder", report))
        say("(kopieret)")
    }

    /** Så mange billeder sendes højst ad gangen (ca. 20 MB); resten hentes næste gang. */
    private val maxThumbs = 120

    /**
     * Op til 5 billeder pr. dag, fordelt over dagen: dagen deles i lige store stykker, og i hvert
     * stykke vælges billedet nærmest midten. Billeder taget under 2 minutter fra et valgt springes
     * over (serier af næsten ens billeder). Udgaver på 1080 px som "B;id;taget-ms;base64".
     */
    private fun thumbs(camera: List<Pic>, base: android.net.Uri): List<String> {
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT)
        val byDay = camera.groupBy { day.format(Date(it.taken)) }.toSortedMap()
        val from = fromDay
        val days = byDay.keys.filter { from == null || it >= from }
        val out = ArrayList<String>()
        val t0 = SystemClock.elapsedRealtime()
        var failed = 0
        var next: String? = null
        say("Laver billeder i bedre kvalitet${if (from != null) " fra $from" else ""} …")
        for (d in days) {
            val chosen = pick(byDay[d]!!)
            if (out.isNotEmpty() && out.size + chosen.size > maxThumbs) { next = d; break }
            if (out.size / 20 != (out.size + chosen.size) / 20) say("… ${out.size + chosen.size} billeder (${(SystemClock.elapsedRealtime() - t0) / 1000} s)")
            for (p in chosen) {
                try {
                    out.add("B;${p.id + idBase};${p.taken};${small(ContentUris.withAppendedId(base, p.id))}")
                } catch (e: Throwable) {
                    failed++
                    if (failed <= 3) say("Lille billede fejlede (${p.name}): ${e.javaClass.simpleName}: ${e.message}")
                }
            }
        }
        say("Små billeder: ${out.size} fra ${days.size} dage${if (from != null) " (fra $from)" else ""} på ${(SystemClock.elapsedRealtime() - t0) / 1000} s · fejl: $failed")
        if (next != null) {
            say("Flere mangler: næste gang fra $next")
            out.add(0, "# næste $next")
        }
        return out
    }

    /**
     * Én runde "Gem på Drev": op til 5 filer á 120 billeder (ca. 100 MB), som deles på én gang (vælg Drev).
     * Appen husker selv, hvor langt den er nået; tryk igen, til den skriver "Færdig".
     */
    private fun driveRound() {
        val prefs = getSharedPreferences("billeder", 0)
        var from = prefs.getString("driveFrom", null)
        var part = prefs.getInt("drivePart", 0)
        if (from == "done") { from = null; part = 0 }
        idBase = 1_000_000_000_000L
        val base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val cols = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.RELATIVE_PATH, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_MODIFIED)
        val camera = ArrayList<Pic>()
        contentResolver.query(base, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val taken = if (c.isNull(2) || c.getLong(2) == 0L) c.getLong(5) * 1000 else c.getLong(2)
                val pic = Pic(c.getLong(0), c.getString(1) ?: "", taken, c.getString(3) ?: "", c.getLong(4))
                if (pic.path.startsWith("DCIM/")) camera.add(pic)
            }
        }
        camera.sortBy { it.taken }
        if (camera.isEmpty()) { say("Ingen billeder i DCIM. Har appen fået lov til alle billeder?"); return }
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT)
        say("Gem på Drev: ${camera.size} kamera-billeder fra ${day.format(Date(camera.first().taken))} til ${day.format(Date(camera.last().taken))}${if (from != null) " · fortsætter fra $from" else ""}")
        val files = ArrayList<File>()
        // Dato og sted for alle billeder kommer med i den første fil
        var places: List<String> = if (from == null) readAll(camera, base) else emptyList()
        for (i in 0 until 5) {
            fromDay = from
            val t = thumbs(camera, base)
            val next = t.firstOrNull { it.startsWith("# næste ") }?.removePrefix("# næste ")
            part++
            val f = File(ShareProvider.dir(this), "dagbog-billeder-del-$part.txt")
            f.bufferedWriter().use { w ->
                w.write("DAGBOG-BILLEDER v2\n# app ${appVersion()}\n# størrelse $THUMB_PX\n# kilde anden telefon (${Build.MODEL}) del $part\n")
                for (l in places) { w.write(l); w.write("\n") }
                for (l in t) if (!l.startsWith("# næste ")) { w.write(l); w.write("\n") }
            }
            places = emptyList()
            files.add(f)
            say("Del $part: ${f.length() / 1_048_576} MB")
            from = next
            if (next == null) break
        }
        prefs.edit().putString("driveFrom", from ?: "done").putInt("drivePart", part).apply()
        say(if (from == null) "Færdig: alle billeder er med. Gem filerne på Drev." else "Gem filerne på Drev, og tryk så \"Gem på Drev\" igen (fortsætter fra $from).")
        val uris = ArrayList(files.map { ShareProvider.uri(it.name) })
        val send = Intent(Intent.ACTION_SEND_MULTIPLE).setType("text/plain")
        send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        send.clipData = ClipData.newRawUri(files.first().name, uris.first()).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runOnUiThread {
            try {
                startActivity(Intent.createChooser(send, "Gem på Drev").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            } catch (e: Exception) {
                say("FEJL ved deling: ${e.javaClass.simpleName}: ${e.message}")
            }
        }
    }

    private fun pick(list: List<Pic>): List<Pic> {
        val sorted = list.sortedBy { it.taken }
        if (sorted.size <= 5) return sorted
        val first = sorted.first().taken
        val span = sorted.last().taken - first
        val chosen = ArrayList<Pic>()
        for (i in 0 until 5) {
            val target = first + span * (2 * i + 1) / 10
            val near = sorted.filter { p -> p !in chosen && chosen.none { kotlin.math.abs(it.taken - p.taken) < 120_000 } }
            val best = near.minByOrNull { kotlin.math.abs(it.taken - target) } ?: continue
            chosen.add(best)
        }
        return chosen.sortedBy { it.taken }
    }

    private fun small(uri: android.net.Uri): String {
        val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(contentResolver, uri)) { dec, info, _ ->
            val w = info.size.width
            val h = info.size.height
            val scale = THUMB_PX.toDouble() / maxOf(w, h)
            if (scale < 1) dec.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
            dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        val bytes = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 80, bytes)
        bmp.recycle()
        return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
    }

    /** Skriver alt til én tekstfil: første linje fortæller Dagbog, hvad det er; "#" er appens log. */
    private fun writeFile(lines: List<String>): File {
        val f = File(ShareProvider.dir(this), "dagbog-billeder.txt")
        f.bufferedWriter().use { w ->
            w.write("DAGBOG-BILLEDER v2\n# app ${appVersion()}\n# størrelse $THUMB_PX\n")
            for (l in report.lines()) if (l.isNotBlank()) w.write("# $l\n")
            for (l in lines) { w.write(l); w.write("\n") }
        }
        say("Fil: ${f.length() / 1024} kB")
        return f
    }

    /**
     * Sender filen til Dagbog. Findes Dagbog blandt de apps, der kan modtage tekst, åbnes den
     * direkte (uden Del-menuen); ellers vises Del-menuen.
     */
    private fun sendToDagbog(file: File) {
        val uri = ShareProvider.uri(file.name)
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
        val targets = packageManager.queryIntentActivities(send, 0)
        val hit = targets.firstOrNull { it.loadLabel(packageManager).toString().trim().equals("Dagbog", ignoreCase = true) }
        say("Dagbog fundet: ${hit?.activityInfo?.packageName ?: "NEJ"}")
        send.putExtra(Intent.EXTRA_STREAM, uri)
        send.clipData = ClipData.newRawUri(file.name, uri)
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            if (hit != null) {
                startActivity(send.setClassName(hit.activityInfo.packageName, hit.activityInfo.name))
            } else {
                startActivity(Intent.createChooser(send, "Send til Dagbog"))
            }
        } catch (e: Exception) {
            say("FEJL ved afsendelse: ${e.javaClass.simpleName}: ${e.message}")
        }
    }
}
