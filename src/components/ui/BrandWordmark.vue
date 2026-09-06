<template>
  <!-- Rounded vector lettering keeps the reference shape without a system font dependency. -->
  <svg
    viewBox="0 0 620 116"
    fill="none"
    aria-hidden="true"
    focusable="false"
    class="brand-wordmark pointer-events-none block shrink-0"
  >
    <g
      class="brand-wordmark-name"
      stroke="currentColor"
      stroke-width="17"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M10 106V10L55 72L99 10V106" />
      <path d="M132 41V106M164 106V78C164 54 177 41 194 41H195" />
      <circle
        cx="245"
        cy="74"
        r="33"
      />
      <path d="M278 74V106M309 41V106" />
      <g
        fill="currentColor"
        stroke="none"
      >
        <circle
          cx="132"
          cy="10"
          r="9.5"
        />
        <circle
          cx="309"
          cy="10"
          r="9.5"
        />
      </g>
    </g>
    <g
      class="brand-wordmark-hub"
      stroke="currentColor"
      stroke-width="17"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M355 10V106M425 10V106M355 57H425" />
      <path d="M456 41V77C456 96 466 107 483.5 107S511 96 511 77V41" />
      <path d="M542 10V74" />
      <circle
        cx="575"
        cy="74"
        r="33"
      />
    </g>
  </svg>
</template>

<style scoped>
.brand-wordmark {
  width: 70px;
  height: auto;
}

.brand-wordmark-name {
  /* Preserve the reference's gray-purple hue, with a readable tone on dark skins. */
  color: light-dark(#4d4769, #d8d2ed);
}

.brand-wordmark-hub {
  color: #a179ff;
}
</style>
