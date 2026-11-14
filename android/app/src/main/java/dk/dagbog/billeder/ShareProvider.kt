package dk.dagbog.billeder

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/**
 * Giver Dagbog adgang til den ene fil, der sendes (cache/share/). Kun læsning, og kun med den
 * tilladelse, der følger med afsendelsen. Lille egen udgave i stedet for androidx FileProvider.
 */
class ShareProvider : ContentProvider() {

    companion object {
        const val AUTHORITY = "dk.dagbog.billeder.share"
        fun dir(context: android.content.Context) = File(context.cacheDir, "share").apply { mkdirs() }
        fun uri(name: String): Uri = Uri.parse("content://$AUTHORITY/${Uri.encode(name)}")
    }

    private fun file(uri: Uri): File? {
        val name = uri.lastPathSegment ?: return null
        val f = File(dir(context!!), name)
        return if (f.parentFile?.canonicalPath == dir(context!!).canonicalPath && f.exists()) f else null
    }

    override fun onCreate() = true

    override fun getType(uri: Uri) = "text/plain"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val f = file(uri) ?: return null
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, args: Array<String>?, sort: String?): Cursor? {
        val f = file(uri) ?: return null
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val row = cols.map { if (it == OpenableColumns.DISPLAY_NAME) f.name else if (it == OpenableColumns.SIZE) f.length() else null }
        return MatrixCursor(cols, 1).apply { addRow(row) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, args: Array<String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<String>?) = 0
}
