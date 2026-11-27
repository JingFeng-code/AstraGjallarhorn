<script setup lang="ts">
import { ref } from "vue";

type Note = { id: number; title: string };
const draft = ref("");
const title = ref("");
const error = ref("");
const busy = ref(false);

async function save() {
  busy.value = true;
  error.value = "";
  title.value = "";
  try {
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draft.value }),
    });
    if (!response.ok) throw new Error("Save failed");
    const saved: Note = await response.json();
    const readback = await fetch("/api/notes/" + saved.id);
    if (!readback.ok) throw new Error("Load failed");
    const note: Note = await readback.json();
    title.value = note.title;
  } catch {
    error.value = "Unable to save note";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main>
    <h1>Note titles</h1>
    <form @submit.prevent="save">
      <label for="title">Title</label>
      <input id="title" v-model="draft">
      <button :disabled="busy">Save</button>
    </form>
    <p role="status">{{ title }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>
