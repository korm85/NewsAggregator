package com.gavan.capture.ui

import android.graphics.BitmapFactory
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.gavan.capture.databinding.ItemGalleryBinding
import com.gavan.capture.storage.StoredCapture

class GalleryAdapter(
    private var items: List<StoredCapture>,
    private val onDelete: (StoredCapture) -> Unit,
) : RecyclerView.Adapter<GalleryAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemGalleryBinding) : RecyclerView.ViewHolder(binding.root)

    fun submit(newItems: List<StoredCapture>) {
        items = newItems
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemGalleryBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        val bitmap = BitmapFactory.decodeFile(item.bestStillPath)
        holder.binding.thumbnail.setImageBitmap(bitmap)
        holder.binding.capturedAt.text = item.capturedAt
        holder.binding.deleteBtn.setOnClickListener { onDelete(item) }
    }

    override fun getItemCount(): Int = items.size
}
