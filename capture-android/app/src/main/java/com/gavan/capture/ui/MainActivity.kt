package com.gavan.capture.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.gavan.capture.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val requestCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startActivity(Intent(this, ViewfinderActivity::class.java))
        } else {
            binding.statusText.text = "Camera access is required. Check app permissions in Settings, then try again."
            binding.statusText.visibility = android.view.View.VISIBLE
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.enableCameraBtn.setOnClickListener { onEnableCamera() }
        binding.galleryBtn.setOnClickListener {
            startActivity(Intent(this, GalleryActivity::class.java))
        }
    }

    private fun onEnableCamera() {
        binding.statusText.visibility = android.view.View.GONE
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startActivity(Intent(this, ViewfinderActivity::class.java))
        } else {
            requestCamera.launch(Manifest.permission.CAMERA)
        }
    }
}
