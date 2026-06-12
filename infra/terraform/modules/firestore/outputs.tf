output "database_name" {
  description = "Firestore データベース名"
  value       = google_firestore_database.default.name
}

output "database_id" {
  description = "Firestore データベースの完全 ID"
  value       = google_firestore_database.default.id
}