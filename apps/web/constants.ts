
export const APP_NAME = "Maine Farm Market";
export const MAINE_STATE = "ME";

export const PRICING = {
  PRODUCER: 30,
  BUYER: 7
};

export const CATEGORIES = [
  "Vegetables",
  "Fruits",
  "Dairy & Eggs",
  "Meat & Poultry",
  "Seafood",
  "Baked Goods",
  "Maple & Honey",
  "Plants & Seeds"
];

export const MOCK_PRODUCERS = [
  {
    id: "p1",
    name: "Cumberland Roots Farm",
    bio: "Small scale vegetable farm focused on organic practices in the heart of Cumberland County.",
    image: "https://picsum.photos/seed/farm1/600/400",
    city: "Cumberland"
  },
  {
    id: "p2",
    name: "Downeast Berries",
    bio: "Fresh blueberries and raspberries from the pristine coast of Maine.",
    image: "https://picsum.photos/seed/farm2/600/400",
    city: "Ellsworth"
  },
  {
    id: "p3",
    name: "Pine Tree Dairy",
    bio: "Family owned dairy farm providing fresh milk and artisanal cheeses.",
    image: "https://picsum.photos/seed/farm3/600/400",
    city: "Augusta"
  }
];

export const MOCK_PRODUCTS = [
  {
    id: "pr1",
    producerId: "p1",
    producerName: "Cumberland Roots Farm",
    title: "Organic Heirloom Tomatoes",
    category: "Vegetables",
    description: "Multi-colored sweet tomatoes grown without pesticides.",
    price: 6.50,
    unit: "lb",
    image: "https://picsum.photos/seed/tomato/400/300",
    inStock: true,
    quantityAvailable: 45
  },
  {
    id: "pr2",
    producerId: "p1",
    producerName: "Cumberland Roots Farm",
    title: "Fresh Bunched Carrots",
    category: "Vegetables",
    description: "Crunchy orange carrots with greens still attached.",
    price: 4.00,
    unit: "bunch",
    image: "https://picsum.photos/seed/carrot/400/300",
    inStock: true,
    quantityAvailable: 20
  },
  {
    id: "pr3",
    producerId: "p2",
    producerName: "Downeast Berries",
    title: "Wild Maine Blueberries",
    category: "Fruits",
    description: "The classic tiny blue powerhouses, frozen within hours of picking.",
    price: 12.00,
    unit: "2lb bag",
    image: "https://picsum.photos/seed/berry/400/300",
    inStock: true,
    quantityAvailable: 100
  },
  {
    id: "pr4",
    producerId: "p3",
    producerName: "Pine Tree Dairy",
    title: "Sharp Aged Cheddar",
    category: "Dairy & Eggs",
    description: "Aged for 12 months, sharp and crumbly.",
    price: 15.00,
    unit: "lb",
    image: "https://picsum.photos/seed/cheese/400/300",
    inStock: true,
    quantityAvailable: 15
  }
];
