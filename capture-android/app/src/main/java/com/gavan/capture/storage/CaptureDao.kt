package com.gavan.capture.storage

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface CaptureDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(capture: CaptureEntity)

    @Query("SELECT * FROM captures ORDER BY capturedAt DESC")
    suspend fun listAll(): List<CaptureEntity>

    @Query("DELETE FROM captures WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM captures")
    suspend fun clear()
}
