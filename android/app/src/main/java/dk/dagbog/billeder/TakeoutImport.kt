package dk.dagbog.billeder

import android.content.ContentResolver
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.media.ExifInterface
import android.net.Uri
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.CRC32
import java.util.zip.ZipInputStream

/**
 * Henter billeder fra en Google Takeout af Google Fotos (alle zip-filer på én gang, fordi Google lægger
 * billederne og deres json-filer i forskellige zip-filer). Læser hver fil én gang: små billeder (1080 px)
 * laves undervejs og lægges i appens mellemlager; til sidst findes datoen (Googles json → billedets EXIF →
 * filnavnet), op til 5 pr. dag vælges, og det hele skrives i filer á 120 billeder i Download/Dagbog-Takeout,
 * som vælges i Dagbog under "Billeder fra en gammel telefon". Skærmbilleder og videoer springes over.
 */
class TakeoutImport(
    private val resolver: ContentResolver,
    private val cache: File,
    private val say: (String) -> Unit,
    private val version: String,
) {
    private data class Pic(
        val id: Long, val dir: String, val file: String, val size: Long,
        val exifT: Long?, val nameT: Long?, val lat: Double?, val lng: Double?,
    )
    private data class Meta(val taken: Long, val lat: Double?, val lng: Double?, val names: List<String> = emptyList())

    /** Json-filer med feltet "people" (navne, ejeren har sat på ansigter i Google Fotos). */
    private var jsonWithPeopleField = 0

    private val pics = ArrayList<Pic>()
    private val metaByDir = HashMap<String, Meta>() // "mappe/titel" → dato og sted
    private val metaByName = HashMap<String, Meta>() // "titel" → dato og sted (json i en anden mappe/zip)
    private val seen = HashSet<String>() // samme billede i flere album-mapper: "navn|størrelse"
    private var skippedShots = 0
    private var skippedVideo = 0
    private var skippedDup = 0
    private var failed = 0

    private val thumbDir = File(cache, "takeout").apply { deleteRecursively(); mkdirs() }
    private val day = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT)
    private val exifFmt = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.ROOT)
    private val nameFmt = SimpleDateFormat("yyyyMMddHHmmss", Locale.ROOT)
    private val nameFmtUtc = SimpleDateFormat("yyyyMMddHHmmss", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }

    private val imageExt = setOf("jpg", "jpeg", "heic", "heif", "png", "webp")
    private val videoExt = setOf("mp4", "mov", "3gp", "m4v", "avi", "mkv", "mp", "gif")

    fun run(uris: List<Uri>) {
        val t0 = SystemClock.elapsedRealtime()
        // Filerne i navneorden (…-1-001, …-1-002 …), så fremdriften er til at følge
        val named = uris.map { it to name(it) }.sortedBy { it.second.second }
        val saved = ArrayList<String>()
        for ((k, pair) in named.withIndex()) {
            val (uri, info) = pair
            say("")
            say("== Fil ${k + 1} af ${named.size}: ${info.second} · ${mb(info.first)} ==")
            // Hver zip-fil gemmes for sig, så intet går tabt, hvis appen eller Drev stopper undervejs
            pics.clear()
            thumbDir.listFiles()?.forEach { it.delete() }
            var ok = false
            // Drev giver nogle gange op ("Cello error"): vent lidt, og prøv igen op til 2 gange
            for (attempt in 1..3) {
                try {
                    readZip(uri)
                    ok = true
                    break
                } catch (e: Throwable) {
                    say("FEJL i ${info.second} (forsøg $attempt af 3): ${e.javaClass.simpleName}: ${e.message}")
                    pics.clear()
                    thumbDir.listFiles()?.forEach { it.delete() }
                    if (attempt < 3) { say("Venter 30 s og prøver igen …"); Thread.sleep(30_000) }
                }
            }
            if (!ok) { say("⚠ ${info.second} blev ikke læst. Prøv den igen senere (gerne fra Downloads)."); continue }
            val tag = Regex("(\\d+-\\d+)\\.zip$").find(info.second)?.groupValues?.get(1) ?: String.format(Locale.ROOT, "%02d", k + 1)
            saved += finish(tag)
            say("Tid indtil nu: ${(SystemClock.elapsedRealtime() - t0) / 60000} min")
        }
        say("")
        say("Sprunget over: skærmbilleder $skippedShots · video $skippedVideo · samme billede i flere mapper $skippedDup · fejl $failed")
        say("Tid i alt: ${(SystemClock.elapsedRealtime() - t0) / 60000} min")
        thumbDir.deleteRecursively()
        say("")
        if (saved.isEmpty()) say("Ingen filer gemt.")
        else say("FÆRDIG. ${saved.size} filer i Download/Dagbog-Takeout. Åbn Dagbog → Mere → Billeder og steder → Flere måder at hente → \"Vælg filer\", og vælg dem alle (du kan også hente dem ind løbende, mens appen arbejder).")
    }

    private fun name(uri: Uri): Pair<Long, String> {
        var n = uri.lastPathSegment ?: "?"
        var s = -1L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) { n = c.getString(0) ?: n; s = if (c.isNull(1)) -1 else c.getLong(1) }
            }
        } catch (_: Exception) {}
        return s to n
    }

    private fun readZip(uri: Uri) {
        val t0 = SystemClock.elapsedRealtime()
        say("Åbner filen (Drev henter den først, ca. 2 min pr. 2 GB) …")
        val opened = AtomicBoolean(false)
        kotlin.concurrent.thread {
            var s = 0
            while (!opened.get()) {
                Thread.sleep(1000)
                s++
                if (!opened.get() && s % 15 == 0) say("… venter på filen fra Drev ($s s)")
            }
        }
        val raw = try { resolver.openInputStream(uri) } finally { opened.set(true) }
        if (raw == null) { say("Kunne ikke åbne filen."); return }
        say("Åben efter ${(SystemClock.elapsedRealtime() - t0) / 1000} s. Læser …")
        val zip = ZipInputStream(BufferedInputStream(raw, 1 shl 16))
        var entries = 0
        var made = 0
        var lastSay = SystemClock.elapsedRealtime()
        zip.use {
            while (true) {
                val e = zip.nextEntry ?: break
                if (e.isDirectory) continue
                entries++
                val path = e.name
                val slash = path.lastIndexOf('/')
                val dir = if (slash >= 0) path.substring(0, slash) else ""
                val file = path.substring(slash + 1)
                val ext = file.substringAfterLast('.', "").lowercase(Locale.ROOT)
                when {
                    ext == "json" -> json(dir, file, readBytes(zip, 512 * 1024))
                    ext in videoExt -> skippedVideo++
                    ext in imageExt -> {
                        if (file.contains("screenshot", ignoreCase = true) || dir.contains("screenshot", ignoreCase = true)) {
                            skippedShots++
                        } else {
                            val bytes = readBytes(zip, 60 * 1024 * 1024)
                            if (!seen.add("$file|${bytes.size}")) skippedDup++
                            else if (image(dir, file, bytes)) made++
                        }
                    }
                }
                zip.closeEntry()
                val now = SystemClock.elapsedRealtime()
                if (now - lastSay > 15_000) {
                    lastSay = now
                    say("… $entries filer · $made små billeder lavet · ${(now - t0) / 1000} s")
                }
            }
        }
        say("Færdig med filen: $entries filer · $made små billeder · ${(SystemClock.elapsedRealtime() - t0) / 1000} s")
    }

    /** Googles json: "IMG_1.jpg.supplemental-metadata(1).json" hører til billedet "IMG_1(1).jpg". */
    private fun json(dir: String, file: String, bytes: ByteArray) {
        try {
            val o = JSONObject(String(bytes, Charsets.UTF_8))
            val ts = o.optJSONObject("photoTakenTime")?.optString("timestamp")?.toLongOrNull() ?: return
            val title = o.optString("title").ifEmpty { return }
            val g = o.optJSONObject("geoData")
            val gx = o.optJSONObject("geoDataExif")
            var lat = g?.optDouble("latitude") ?: 0.0
            var lng = g?.optDouble("longitude") ?: 0.0
            if (lat == 0.0 && lng == 0.0) { lat = gx?.optDouble("latitude") ?: 0.0; lng = gx?.optDouble("longitude") ?: 0.0 }
            // Navne fra Google Fotos' "Personer" (kun ansigter, ejeren selv har givet navn)
            val ppl = o.optJSONArray("people")
            if (ppl != null) jsonWithPeopleField++
            val names = if (ppl == null) emptyList() else (0 until ppl.length()).mapNotNull { ppl.optJSONObject(it)?.optString("name")?.trim()?.takeIf { n -> n.isNotEmpty() } }.distinct()
            val m = Meta(ts * 1000, if (lat != 0.0 || lng != 0.0) lat else null, if (lat != 0.0 || lng != 0.0) lng else null, names)
            val n = Regex("\\((\\d+)\\)\\.json$").find(file)?.groupValues?.get(1)
            val key = if (n != null) withSuffix(title, "($n)") else title
            metaByDir["$dir/$key"] = m
            metaByName.putIfAbsent(key, m)
        } catch (_: Exception) {}
    }

    private fun withSuffix(name: String, suffix: String): String {
        val dot = name.lastIndexOf('.')
        return if (dot > 0) name.substring(0, dot) + suffix + name.substring(dot) else name + suffix
    }

    /** Laver det lille billede med det samme (det store billede kan ikke gemmes til senere) og husker datoen fra EXIF og filnavnet. */
    private fun image(dir: String, file: String, bytes: ByteArray): Boolean {
        val crc = CRC32().apply { update("$dir/$file".toByteArray()) }.value
        val id = 2_000_000_000_000L + crc
        var exifT: Long? = null
        var lat: Double? = null
        var lng: Double? = null
        try {
            val x = ExifInterface(ByteArrayInputStream(bytes))
            x.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)?.let { exifT = synchronized(exifFmt) { exifFmt.parse(it)?.time } }
            val ll = FloatArray(2)
            if (x.getLatLong(ll) && (ll[0] != 0f || ll[1] != 0f)) { lat = ll[0].toDouble(); lng = ll[1].toDouble() }
        } catch (_: Exception) {}
        val nameT = Regex("(\\d{8})[_-](\\d{6})").find(file)?.let { m ->
            try { (if (file.startsWith("PXL_")) nameFmtUtc else nameFmt).parse(m.groupValues[1] + m.groupValues[2])?.time } catch (_: Exception) { null }
        }
        return try {
            val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { dec, info, _ ->
                val w = info.size.width
                val h = info.size.height
                val scale = THUMB.toDouble() / maxOf(w, h)
                if (scale < 1) dec.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
                dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
            File(thumbDir, "$id.jpg").outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
            bmp.recycle()
            pics.add(Pic(id, dir, file, bytes.size.toLong(), exifT, nameT, lat, lng))
            true
        } catch (e: Throwable) {
            failed++
            if (failed <= 5) say("Billede kunne ikke åbnes ($file): ${e.javaClass.simpleName}: ${e.message}")
            false
        }
    }

    private fun metaFor(p: Pic): Meta? {
        val names = listOf(p.file, p.file.replace(Regex("-(redigeret|edited|bearbeitet)(?=\\.)", RegexOption.IGNORE_CASE), ""))
        for (n in names) {
            metaByDir["${p.dir}/$n"]?.let { return it }
            metaByName[n]?.let { return it }
        }
        return null
    }

    private data class Done(val id: Long, val t: Long, val lat: Double?, val lng: Double?, val names: List<String> = emptyList())

    /** Gemmer billederne fra én zip-fil; giver navnene på de gemte filer. */
    private fun finish(tag: String): List<String> {
        var fromJson = 0
        var fromExif = 0
        var fromName = 0
        var noDate = 0
        val done = ArrayList<Done>()
        val dupTime = HashSet<String>()
        for (p in pics) {
            val m = metaFor(p)
            val t = when {
                m != null -> { fromJson++; m.taken }
                p.exifT != null -> { fromExif++; p.exifT }
                p.nameT != null -> { fromName++; p.nameT }
                else -> { noDate++; null }
            } ?: continue
            if (!dupTime.add("$t|${p.size}")) continue // samme billede to gange (fx original og kopi)
            done.add(Done(p.id, t, m?.lat ?: p.lat, m?.lng ?: p.lng, m?.names ?: emptyList()))
        }
        say("Dato fra: Googles json $fromJson · billedets EXIF $fromExif · filnavnet $fromName · uden dato $noDate")
        say("Med sted: ${done.count { it.lat != null }} af ${done.size}")
        // Navne fra Google Fotos: hvor mange billeder, og hvem
        val named = done.filter { it.names.isNotEmpty() }
        val byName = named.flatMap { it.names }.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }
        say("Navne fra Google Fotos: ${named.size} af ${done.size} billeder har navne (json med \"people\"-felt indtil nu: $jsonWithPeopleField)")
        if (byName.isNotEmpty()) say("  " + byName.take(20).joinToString(" · ") { "${it.key} ${it.value}" })
        if (done.isEmpty()) { say("Ingen billeder at sende."); return emptyList() }
        done.sortBy { it.t }
        say("Fra ${day.format(Date(done.first().t))} til ${day.format(Date(done.last().t))}")

        // Op til 5 pr. dag, fordelt over dagen (samme regel som for telefonens billeder)
        val chosen = done.groupBy { day.format(Date(it.t)) }.toSortedMap().values.flatMap { pick(it) }
        say("Dage: ${done.groupBy { day.format(Date(it.t)) }.size} · små billeder valgt: ${chosen.size}")

        // Filer á 120 billeder i Download/Dagbog-Takeout; dato og sted for alle i den første
        val parts = chosen.chunked(120).ifEmpty { listOf(emptyList()) }
        val names = ArrayList<String>()
        for ((k, part) in parts.withIndex()) {
            val name = "dagbog-takeout-$tag-del-${String.format(Locale.ROOT, "%02d", k + 1)}.txt"
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, "text/plain")
                put(MediaStore.Downloads.RELATIVE_PATH, "Download/Dagbog-Takeout")
            }
            val out = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            if (out == null) { say("FEJL: kunne ikke gemme $name i Download"); return names }
            resolver.openOutputStream(out)?.bufferedWriter()?.use { w ->
                w.write("DAGBOG-BILLEDER v2\n# app $version\n# størrelse $THUMB\n# kilde anden telefon (Google Takeout) del ${k + 1}\n")
                if (k == 0) for (d in done) {
                    w.write("${d.id};${d.t};${if (d.lat != null) String.format(Locale.ROOT, "%.5f;%.5f", d.lat, d.lng) else ";"}\n")
                    // Navne fra Google Fotos (Dagbog bruger dem ikke endnu; ældre Dagbog springer linjen over)
                    if (d.names.isNotEmpty()) w.write("P;${d.id};${d.t};${d.names.joinToString("|") { it.replace(";", ",").replace("|", "/") }}\n")
                }
                for (d in part) {
                    val f = File(thumbDir, "${d.id}.jpg")
                    if (!f.exists()) continue
                    w.write("B;${d.id};${d.t};")
                    w.write(Base64.encodeToString(f.readBytes(), Base64.NO_WRAP))
                    w.write("\n")
                }
            }
            say("Gemt: Download/Dagbog-Takeout/$name (${part.size} billeder)")
            names += name
        }
        return names
    }

    private fun pick(list: List<Done>): List<Done> {
        if (list.size <= 5) return list
        val first = list.first().t
        val span = list.last().t - first
        val chosen = ArrayList<Done>()
        for (i in 0 until 5) {
            val target = first + span * (2 * i + 1) / 10
            val best = list.filter { p -> p !in chosen && chosen.none { kotlin.math.abs(it.t - p.t) < 120_000 } }
                .minByOrNull { kotlin.math.abs(it.t - target) } ?: continue
            chosen.add(best)
        }
        return chosen.sortedBy { it.t }
    }

    private fun mb(b: Long) = if (b < 0) "? MB" else String.format(Locale.ROOT, "%.0f MB", b / 1_048_576.0)

    private fun readBytes(input: InputStream, max: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val b = ByteArray(1 shl 16)
        while (true) {
            val n = input.read(b)
            if (n < 0) break
            if (out.size() < max) out.write(b, 0, minOf(n, max - out.size()))
        }
        return out.toByteArray()
    }

    companion object {
        const val THUMB = 1080
    }
}
