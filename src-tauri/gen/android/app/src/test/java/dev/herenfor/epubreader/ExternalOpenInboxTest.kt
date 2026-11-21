package dev.herenfor.epubreader

import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalOpenInboxTest {
  @Test
  fun acceptsEpubByMimeOrExtension() {
    assertTrue(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", "application/epub+zip", null))
    assertTrue(isSupportedExternalOpen(Intent.ACTION_VIEW, "file", null, "/storage/Books/Novel.EPUB"))
  }

  @Test
  fun acceptsTxtByMimeOrExtension() {
    assertTrue(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", "text/plain", "42"))
    assertTrue(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", "text/plain; charset=utf-8", null))
    assertTrue(isSupportedExternalOpen(Intent.ACTION_VIEW, "file", null, "/storage/Download/Novel.TXT"))
  }

  @Test
  fun acceptsOpaqueContentUriOnlyWhenTheMimeTypeIsSupported() {
    assertTrue(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", "text/plain", "document/primary:Download/novel"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", null, "document/primary:Download/novel"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", null, "document/primary:Download/novel.pdf"))
  }

  @Test
  fun rejectsUnsupportedActionsSchemesAndTypes() {
    assertFalse(isSupportedExternalOpen(Intent.ACTION_SEND, "content", "text/plain", "novel.txt"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "https", "text/plain", "novel.txt"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", "text/html", "page.html"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", "application/pdf", "book.pdf"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "content", "application/octet-stream", "book.bin"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "file", null, "/storage/Download/notes.log"))
    assertFalse(isSupportedExternalOpen(Intent.ACTION_VIEW, "file", null, null))
  }
}
