/// <reference types="@sveltejs/kit" />

declare namespace App {
  interface Locals {
    user?: import('$lib/types').AppUser;
  }
}
