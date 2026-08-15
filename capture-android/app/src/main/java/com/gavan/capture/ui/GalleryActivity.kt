package com.gavan.capture.ui

import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import com.gavan.capture.databinding.ActivityGalleryBinding
import com.gavan.capture.storage.CaptureRepository
import kotlinx.coroutines.launch

class GalleryActivity : AppCompatActivity() {

    private lateinit var binding: ActivityGalleryBinding
    private lateinit var repository: CaptureRepository
    private lateinit var adapter: GalleryAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityGalleryBinding.inflate(layoutInflater)
        setContentView(binding.root)

        repository = CaptureRepository(this)
        adapter = GalleryAdapter(emptyList()) { capture ->
            lifecycleScope.launch {
                repository.delete(capture.id)
                reload()
            }
        }
        binding.galleryGrid.layoutManager = GridLayoutManager(this, 3)
        binding.galleryGrid.adapter = adapter

        reload()
    }

    override fun onResume() {
        super.onResume()
        reload()
    }

    private fun reload() {
        lifecycleScope.launch {
            val items = repository.list()
            adapter.submit(items)
            binding.emptyText.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        }
    }
}
