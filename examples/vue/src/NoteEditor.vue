<script setup lang="ts">
import { ref } from "vue";
import { normalizeTitle } from "./title";

const draft = ref("");
const title = ref("");

function save() {
  title.value = normalizeTitle(draft.value);
}
</script>

<template>
  <main>
    <h1>Note titles</h1>
    <form @submit.prevent="save">
      <label for="title">Title</label>
      <input id="title" v-model="draft">
      <button>Save</button>
    </form>
    <p role="status">{{ title }}</p>
  </main>
</template>
