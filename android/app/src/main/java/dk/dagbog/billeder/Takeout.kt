package dk.dagbog.billeder

import android.content.ContentResolver
import android.media.ExifInterface
import android.net.Uri
import android.os.SystemClock
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipInputStream

/**
 * Første trin for Google Takeout (Google Fotos): læser zip-filen én gang fra start til slut og
 * skriver i loggen, hvordan den er bygget (mapper, billeder, Googles json-filer med dato og sted,
 * og om billederne selv har dato og sted). Intet gemmes og intet sendes. Loggen deles med Claude,
 * før selve hentningen bygges.
 */
class Takeout(private val resolver: ContentResolver, private val say: (String) -> Unit) {

    /** Tæller, hvor mange bytes der er læst fra filen (til fart og fremdrift). */
    private class Counting(input: InputStream) : FilterInputStream(input) {
        var count = 0L
        override fun read(): Int { val b = super.read(); if (b >= 0) count++; return b }
        override fun read(b: ByteArray, off: Int, len: Int): Int { val n = super.read(b, off, len); if (n > 0) count += n; return n }
        override fun skip(n: Long): Long { val s = super.skip(n); if (s > 0) count += s; return s }
    }

    private data class Meta(val taken: Long, val lat: Double, val lng: Double, val latExif: Double, val lngExif: Double)

    private val day = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply { timeZone = TimeZone.getDefault() }
    private val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT)

    private val imageExt = setOf("jpg", "jpeg", "heic", "heif", "png", "webp", "gif", "dng")
    private val videoExt = setOf("mp4", "mov", "3gp", "m4v", "avi", "mkv", "mp")

    fun probe(uri: Uri) {
        val t0 = SystemClock.elapsedRealtime()
        // Navn og størrelse fra filvælgeren
        var name = "?"
        var size = -1L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) { name = c.getString(0) ?: "?"; size = if (c.isNull(1)) -1 else c.getLong(1) }
            }
        } catch (e: Exception) {
            say("Kunne ikke læse navn/størrelse: ${e.javaClass.simpleName}: ${e.message}")
        }
        say("")
        say("== Takeout: $name · ${mb(size)} ==")
        say("Kilde: ${uri.authority}")

        // Kan filen læses på kryds og tværs (så en senere udgave kan nøjes med at læse den én gang)?
        try {
            resolver.openFileDescriptor(uri, "r")?.use { pfd ->
                val seek = try { Os.lseek(pfd.fileDescriptor, 1024, OsConstants.SEEK_SET); "JA" } catch (e: Exception) { "NEJ (${e.message})" }
                say("Filbeskrivelse: størrelse ${mb(pfd.statSize)} · kan springe i filen: $seek · åbnet på ${SystemClock.elapsedRealtime() - t0} ms")
            }
        } catch (e: Exception) {
            say("Filbeskrivelse: FEJL ${e.javaClass.simpleName}: ${e.message}")
        }

        val raw = resolver.openInputStream(uri) ?: run { say("Kunne ikke åbne filen."); return }
        val counting = Counting(BufferedInputStream(raw, 1 shl 16))
        val zip = ZipInputStream(counting)

        var entries = 0
        val byExt = HashMap<String, Int>()
        val folders = HashMap<String, Int>()
        val jsonNames = HashMap<String, Int>() // slags json-navn: ".supplemental-metadata.json", ".json" osv.
        val meta = HashMap<String, Meta>() // mappe + titel → dato og sted
        val metaByFile = HashMap<String, Meta>() // mappe + json-filnavn uden endelse → dato og sted
        val images = ArrayList<Pair<String, Long>>() // sti, størrelse
        var videos = 0
        var jsonOk = 0
        var jsonOther = 0
        var jsonBad = 0
        var jsonShown = 0
        var exifSamples = 0
        var exifDate = 0
        var exifGps = 0
        var lastSay = SystemClock.elapsedRealtime()

        try {
            while (true) {
                val e = zip.nextEntry ?: break
                if (e.isDirectory) continue
                entries++
                val path = e.name
                val slash = path.lastIndexOf('/')
                val dir = if (slash >= 0) path.substring(0, slash) else ""
                val file = path.substring(slash + 1)
                val ext = file.substringAfterLast('.', "").lowercase(Locale.ROOT)
                byExt[ext] = (byExt[ext] ?: 0) + 1
                val top = path.split('/').take(3).dropLast(1).joinToString("/")
                folders[top] = (folders[top] ?: 0) + 1

                when {
                    ext == "json" -> {
                        val kind = when {
                            file.endsWith(".supplemental-metadata.json") -> ".supplemental-metadata.json"
                            file.contains(".suppl") -> ".suppl…json (forkortet)"
                            file == "metadata.json" -> "metadata.json (album)"
                            else -> "andet .json"
                        }
                        jsonNames[kind] = (jsonNames[kind] ?: 0) + 1
                        val text = readText(zip, 256 * 1024)
                        try {
                            val o = JSONObject(text)
                            val ts = o.optJSONObject("photoTakenTime")?.optString("timestamp")?.toLongOrNull()
                            if (ts != null) {
                                jsonOk++
                                val g = o.optJSONObject("geoData")
                                val gx = o.optJSONObject("geoDataExif")
                                val m = Meta(ts * 1000, g?.optDouble("latitude") ?: 0.0, g?.optDouble("longitude") ?: 0.0,
                                    gx?.optDouble("latitude") ?: 0.0, gx?.optDouble("longitude") ?: 0.0)
                                meta["$dir/${o.optString("title")}"] = m
                                metaByFile["$dir/${file.substringBefore(".json").substringBefore(".suppl")}"] = m
                                if (jsonShown < 2) {
                                    jsonShown++
                                    say("Eksempel på json ($file):")
                                    say(text.replace(Regex("\\s+"), " ").take(700))
                                }
                            } else jsonOther++
                        } catch (x: Exception) {
                            jsonBad++
                            if (jsonBad <= 3) say("Json kunne ikke læses ($file): ${x.message}")
                        }
                    }
                    ext in imageExt -> {
                        images.add("$dir/$file" to e.size)
                        // Dato og sted i selve billedet for et udvalg: de første 8, og så hvert 400.
                        if (images.size <= 8 || images.size % 400 == 0) {
                            val bytes = readBytes(zip, 40 * 1024 * 1024)
                            exifSamples++
                            var d = "MANGLER"
                            var gps = "MANGLER"
                            try {
                                val x = ExifInterface(ByteArrayInputStream(bytes))
                                x.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)?.let { d = it; exifDate++ }
                                val ll = FloatArray(2)
                                if (x.getLatLong(ll)) { gps = String.format(Locale.ROOT, "%.2f, %.2f", ll[0], ll[1]); exifGps++ }
                            } catch (x: Exception) {
                                d = "FEJL ${x.javaClass.simpleName}"
                            }
                            if (exifSamples <= 12) say("Billede $file · ${bytes.size / 1024} kB · EXIF-dato $d · EXIF-sted $gps")
                        }
                    }
                    ext in videoExt -> videos++
                }
                zip.closeEntry()
                val now = SystemClock.elapsedRealtime()
                if (now - lastSay > 10_000) {
                    lastSay = now
                    val s = (now - t0) / 1000
                    say("… $entries filer · ${mb(counting.count)} læst · $s s${if (s > 0) " · ${counting.count / 1_048_576 / s} MB/s" else ""}")
                }
            }
        } catch (e: Throwable) {
            say("FEJL midt i filen efter $entries filer (${mb(counting.count)}): ${e.javaClass.simpleName}: ${e.message}")
        } finally {
            try { zip.close() } catch (_: Exception) {}
        }

        val secs = maxOf(1, (SystemClock.elapsedRealtime() - t0) / 1000)
        say("Læst: $entries filer · ${mb(counting.count)} på $secs s (${counting.count / 1_048_576 / secs} MB/s)")
        say("Endelser: " + byExt.entries.sortedByDescending { it.value }.take(12).joinToString(" · ") { "${it.key.ifEmpty { "(ingen)" }} ${it.value}" })
        say("Mapper: " + folders.entries.sortedByDescending { it.value }.take(10).joinToString(" · ") { "${it.key} ${it.value}" })
        say("Billeder: ${images.size} · video: $videos")
        say("Json: med dato $jsonOk · uden dato $jsonOther · fejl $jsonBad · navne: " + jsonNames.entries.joinToString(" · ") { "${it.key} ${it.value}" })

        // Hvor mange billeder har en json med dato og sted?
        var byTitle = 0
        var byFileName = 0
        var none = 0
        var withGeo = 0
        var withGeoExif = 0
        val found = ArrayList<Meta>()
        val missing = ArrayList<String>()
        for ((p, _) in images) {
            val m = meta[p]?.also { byTitle++ } ?: metaByFile[p]?.also { byFileName++ }
            if (m == null) { none++; if (missing.size < 5) missing.add(p); continue }
            found.add(m)
            if (m.lat != 0.0 || m.lng != 0.0) withGeo++
            if (m.latExif != 0.0 || m.lngExif != 0.0) withGeoExif++
        }
        say("Billeder med json: på titel $byTitle · på filnavn $byFileName · uden $none")
        if (missing.isNotEmpty()) say("Uden json, fx: " + missing.joinToString(" · "))
        say("Med sted i json: geoData $withGeo · geoDataExif $withGeoExif (af ${found.size})")
        if (found.isNotEmpty()) {
            val sorted = found.sortedBy { it.taken }
            say("Dato fra ${stamp.format(Date(sorted.first().taken))} til ${stamp.format(Date(sorted.last().taken))}")
            val days = found.groupingBy { day.format(Date(it.taken)) }.eachCount()
            say("Dage med billeder: ${days.size} · flest på én dag: ${days.values.max()} · dage med over 5: ${days.values.count { it > 5 }}")
            val years = found.groupingBy { day.format(Date(it.taken)).take(4) }.eachCount().toSortedMap()
            say("Pr. år: " + years.entries.joinToString(" · ") { "${it.key} ${it.value}" })
            val sizes = images.map { it.second }.filter { it > 0 }
            if (sizes.isNotEmpty()) say("Billedstørrelse: gennemsnit ${sizes.average().toLong() / 1024} kB · største ${sizes.max() / 1024} kB")
        }
        say("EXIF i udvalget: $exifSamples billeder · med dato $exifDate · med sted $exifGps")
    }

    private fun mb(b: Long) = if (b < 0) "? MB" else String.format(Locale.ROOT, "%.1f MB", b / 1_048_576.0)

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

    private fun readText(input: InputStream, max: Int) = String(readBytes(input, max), Charsets.UTF_8)
}
