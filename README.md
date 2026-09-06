rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() { return request.auth != null; }
    function userDoc() { return firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data; }
    function active() { return signedIn() && userDoc().status == 'active'; }
    function admin() { return active() && userDoc().role in ['owner','admin']; }
    match /companies/{companyId}/customer-images/{customerId}/{fileName} {
      allow read: if active() && userDoc().companyId == companyId;
      allow write: if active() && userDoc().companyId == companyId && userDoc().role in ['owner','admin','manager','staff'] && request.resource.size < 2 * 1024 * 1024 && request.resource.contentType.matches('image/(jpeg|png|webp)');
      allow delete: if active() && userDoc().companyId == companyId && admin();
    }
  }
}
