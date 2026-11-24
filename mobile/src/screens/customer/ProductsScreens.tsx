import { useEffect, useRef, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { endpoints } from '../../api/endpoints';
import type { Product } from '../../api/types';
import { useLoad } from '../../hooks';
import { Button, Card, ErrorView, Message, Screen } from '../../components/ui';
import { colors, radius, spacing, type } from '../../theme';
import type { CustomerStackParamList } from '../../navigation/types';

const money = (n: number) => '₹' + n.toLocaleString('en-IN');
export function ProductsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const { data, error, loading, reload } = useLoad(() => endpoints.products());
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(1, (width - spacing.lg * 2 - 12) / 2);
  return <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}>
    <Text style={[type.h2,{color:colors.text}]}>Products</Text>
    <Text style={[type.small,{color:colors.secondary}]}>Explore products available at Kamal Medical Hall.</Text>
    {loading && !data ? <Text style={type.body}>Loading products…</Text> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel="Retry" /> : !data?.products.length ? <Message icon="cube-outline" title="No products available right now" /> :
      <View style={s.grid}>{data.products.map(p=><Card key={p.id} style={[s.card,{width:cardWidth}]} >
        {p.images[0] ? <Image source={{uri:p.images[0]}} style={s.image} resizeMode="contain"/> : <View style={[s.image,s.placeholder]}><Text style={{color:colors.muted}}>No image</Text></View>}
        <Text style={[type.bodyMedium,{color:colors.text}]} numberOfLines={2}>{p.name}</Text>
        <View style={s.price}><Text style={[type.bodyMedium,{color:colors.primary}]}>{money(p.discountedPrice ?? p.price)}</Text>{p.discountedPrice != null && p.discountedPrice < p.price ? <Text style={s.old}>{money(p.price)}</Text>:null}</View>
        <Button small title="View details" onPress={()=>navigation.navigate('ProductDetail',{productId:p.id})}/>
      </Card>)}</View>}
  </ScrollView>;
}
export function ProductDetailScreen({ route }: NativeStackScreenProps<CustomerStackParamList,'ProductDetail'>) {
  const { width: windowWidth } = useWindowDimensions();
  const detailImageWidth = Math.max(1, windowWidth - spacing.lg * 2);
  const { data,error,loading,reload }=useLoad(()=>endpoints.product(route.params.productId));
  const p=data?.product;
  const galleryRef=useRef<ScrollView>(null);
  const [activeImage,setActiveImage]=useState(0);
  const activeImageRef=useRef(0);
  useEffect(()=>{
    activeImageRef.current=0;
    setActiveImage(0);
    if(!p||p.images.length<2)return;
    const timer=setInterval(()=>{
      activeImageRef.current=(activeImageRef.current+1)%p.images.length;
      setActiveImage(activeImageRef.current);
      galleryRef.current?.scrollTo({x:activeImageRef.current*detailImageWidth,animated:true});
    },3000);
    return ()=>clearInterval(timer);
  },[p?.id,p?.images?.length,detailImageWidth]);
  const onGalleryScrollEnd=(event:NativeSyntheticEvent<NativeScrollEvent>)=>{
    const index=Math.round(event.nativeEvent.contentOffset.x/detailImageWidth);
    activeImageRef.current=index;
    setActiveImage(index);
  };
  if(loading&&!p)return <Screen><Text>Loading product…</Text></Screen>;
  if(error&&!p)return <Screen><ErrorView message={error} onRetry={reload} retryLabel="Retry"/></Screen>;
  if(!p)return <Screen><Message icon="cube-outline" title="Product not found"/></Screen>;
  return <ScrollView contentContainerStyle={s.detail}>
    {p.images.length>0?<>
      <ScrollView ref={galleryRef} horizontal style={{width:detailImageWidth}} contentContainerStyle={{width:detailImageWidth*p.images.length}} pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onGalleryScrollEnd}>
        {p.images.map((uri,i)=><Image key={uri+i} source={{uri}} style={[s.detailImage,{width:detailImageWidth}]} resizeMode="contain"/>)}
      </ScrollView>
      {p.images.length>1?<View style={s.pagination}>{p.images.map((uri,index)=><View key={uri+index} style={[s.dot,index===activeImage?s.activeDot:null]}/>)}</View>:null}
    </>:null}
    <Text style={[type.h2,{color:colors.text}]}>{p.name}</Text>
    <View style={s.price}><Text style={[type.h2,{color:colors.primary}]}>{money(p.discountedPrice ?? p.price)}</Text>{p.discountedPrice != null && p.discountedPrice < p.price ? <Text style={s.old}>{money(p.price)}</Text>:null}</View>
    <Text style={[type.body,{color:colors.secondary}]}>In stock · {p.stockQuantity} available</Text>
    {p.description ? <Text style={[type.body,{color:colors.text,lineHeight:24}]}>{p.description}</Text>:null}
    <Text style={[type.small,{color:colors.secondary}]}>For product enquiries, please contact the store. Online purchase is not available.</Text>
  </ScrollView>;
}
const s=StyleSheet.create({body:{padding:spacing.lg,gap:spacing.md},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',columnGap:12,rowGap:12},card:{flexGrow:0,gap:8},image:{width:'100%',height:130,borderRadius:radius.md,backgroundColor:colors.card},placeholder:{alignItems:'center',justifyContent:'center'},price:{flexDirection:'row',alignItems:'center',gap:8},old:{color:colors.muted,textDecorationLine:'line-through',fontSize:13},detail:{padding:spacing.lg,gap:14},detailImage:{height:260,borderRadius:radius.lg,backgroundColor:colors.card},pagination:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:6},dot:{width:6,height:6,borderRadius:3,backgroundColor:colors.border},activeDot:{width:18,backgroundColor:colors.primary}});
