import type { MenuItem } from "./types";

/** The menu the caff opens with (and resets to). Prices are in pence. */
export const STARTING_MENU: MenuItem[] = [
  {
    id: "full-english",
    name: "Full English",
    category: "breakfast",
    price: 950,
    stock: 12,
    description: "Bacon, sausage, egg, beans, mushrooms, tomato and toast",
    vegetarian: false
  },
  {
    id: "veggie-breakfast",
    name: "Veggie Breakfast",
    category: "breakfast",
    price: 900,
    stock: 10,
    description: "Veggie sausage, egg, beans, halloumi, mushrooms and toast",
    vegetarian: true
  },
  {
    id: "beans-on-toast",
    name: "Beans on Toast",
    category: "breakfast",
    price: 380,
    stock: 15,
    description: "With a knob of butter. Add cheese for free if you ask nicely",
    vegetarian: true
  },
  {
    id: "bacon-butty",
    name: "Bacon Butty",
    category: "sandwiches",
    price: 450,
    stock: 20,
    description: "Back bacon in a soft white bap. Red or brown sauce",
    vegetarian: false
  },
  {
    id: "sausage-sarnie",
    name: "Sausage Sarnie",
    category: "sandwiches",
    price: 450,
    stock: 14,
    description: "Two Cumberland sausages on thick white bread",
    vegetarian: false
  },
  {
    id: "chip-butty",
    name: "Chip Butty",
    category: "sandwiches",
    price: 350,
    stock: 10,
    description: "Hot chips, buttered bread, zero regrets",
    vegetarian: true
  },
  {
    id: "jacket-potato",
    name: "Jacket Potato",
    category: "mains",
    price: 550,
    stock: 8,
    description: "With cheese and beans or tuna mayo",
    vegetarian: true
  },
  {
    id: "pie-and-mash",
    name: "Pie and Mash",
    category: "mains",
    price: 850,
    stock: 6,
    description: "Steak pie, mash and liquor. A London classic",
    vegetarian: false
  },
  {
    id: "sticky-toffee-pudding",
    name: "Sticky Toffee Pudding",
    category: "sweets",
    price: 420,
    stock: 6,
    description: "With custard, obviously",
    vegetarian: true
  },
  {
    id: "builders-tea",
    name: "Builder's Tea",
    category: "drinks",
    price: 180,
    stock: 60,
    description: "Strong, milky, two sugars optional",
    vegetarian: true
  },
  {
    id: "flat-white",
    name: "Flat White",
    category: "drinks",
    price: 320,
    stock: 40,
    description: "Double shot, oat milk on request",
    vegetarian: true
  },
  {
    id: "hot-chocolate",
    name: "Hot Chocolate",
    category: "drinks",
    price: 300,
    stock: 20,
    description: "Squirty cream and marshmallows",
    vegetarian: true
  },
  {
    id: "orange-juice",
    name: "Orange Juice",
    category: "drinks",
    price: 250,
    stock: 20,
    description: "Freshly squeezed, allegedly",
    vegetarian: true
  }
];

/** Stock at or below this level shows as "running low" on the dashboard. */
export const LOW_STOCK = 4;

/** Tables in the caff. */
export const TABLES = { min: 1, max: 12 } as const;
